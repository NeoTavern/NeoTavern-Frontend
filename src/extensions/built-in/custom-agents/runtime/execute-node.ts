import { z } from 'zod';
import { validateSchemaValue } from '../generic/schema';
import type { CompiledNodePlan } from '../graph/plan-types';
import type { JsonObject, JsonValue } from '../graph/contracts';
import { jsonValueSchema } from '../graph/schemas';
import type { DataPortDefinition, NodeExecutionResult } from '../registry/node-definition';
import { projectRequiredProperties } from '../graph/schema-ports';
import { immutableClone, type InvocationExecutionContext, type ScopeRuntimeContext } from './execution-context';
import { graphNodeEffectSchema } from './effects';

const terminalSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('STOP') }),
  z.strictObject({ type: z.literal('RETURN'), outputs: z.record(z.string(), jsonValueSchema) }),
]);
const executionResultSchema: z.ZodType<NodeExecutionResult> = z.strictObject({
  control: z.array(z.string()),
  outputs: z.record(z.string(), jsonValueSchema),
  effects: z.array(graphNodeEffectSchema),
  terminal: terminalSchema.optional(),
});
export function validateBoundaryValue(schema: JsonObject, value: JsonValue, label: string): JsonValue {
  const checked = validateSchemaValue(schema, value, label);
  if (!checked.valid) throw new Error(`${label} failed schema validation: ${checked.errors.join('; ')}`);
  return structuredClone(checked.value);
}

function dataOutputs(node: CompiledNodePlan): DataPortDefinition[] {
  return node.outputs.filter((port): port is DataPortDefinition => port.kind === 'DATA');
}

/** The common schema/completeness boundary for executor and structural node results. */
export function validateNodeOutputs(
  node: CompiledNodePlan,
  flowId: string,
  values: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const ports = dataOutputs(node);
  const outputs: Record<string, JsonValue> = {};
  for (const port of ports) {
    if (port.required && !Object.hasOwn(values, port.id))
      throw new Error(`Required output ${flowId}/${node.id}.${port.id} was omitted`);
  }
  for (const [portId, value] of Object.entries(values)) {
    const port = ports.find((candidate) => candidate.id === portId);
    if (!port) throw new Error(`Node ${node.id} emitted undeclared data output ${portId}`);
    outputs[portId] = validateBoundaryValue(port.schema, value, `Output ${flowId}/${node.id}.${portId}`);
  }
  return outputs;
}

export async function executeExecutorNode(
  invocation: InvocationExecutionContext,
  scope: ScopeRuntimeContext,
  node: CompiledNodePlan,
  inputs: Readonly<Record<string, JsonValue>>,
): Promise<NodeExecutionResult> {
  if (node.definition.runtime.kind !== 'EXECUTOR') throw new Error(`Node ${node.id} does not have an executor`);
  invocation.cancellation();
  const raw = await node.definition.runtime.execute({
    nodeId: node.id,
    flowId: scope.flowId,
    data: node.data,
    inputs: immutableClone(inputs),
    event: invocation.event,
    configuration: invocation.configuration,
    state: immutableClone(invocation.effectState.stateSnapshot()),
    ...(scope.iteration ? { iteration: immutableClone(scope.iteration) } : {}),
    signal: invocation.request.signal,
    random: invocation.request.random,
    ids: invocation.request.ids,
    tools: invocation.request.tools,
    llm: invocation.request.llm,
    templates: invocation.request.templates,
    promptContext: invocation.promptContext,
  });
  invocation.cancellation();
  const parsed = executionResultSchema.parse(raw);

  if (new Set(parsed.control).size !== parsed.control.length)
    throw new Error(`Node ${node.id} emitted duplicate control outputs`);
  for (const portId of parsed.control) {
    const port = node.outputs.find(
      (candidate) => candidate.kind === 'CONTROL' && candidate.direction === 'OUTPUT' && candidate.id === portId,
    );
    if (!port) throw new Error(`Node ${node.id} emitted undeclared control output ${portId}`);
  }
  const projected = structuredClone(parsed.outputs);
  for (const root of dataOutputs(node)) {
    if (!Object.hasOwn(projected, root.id)) continue;
    const value = projected[root.id];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const property of projectRequiredProperties(root.schema)) {
      if (!node.outputs.some((port) => port.kind === 'DATA' && port.id === property.id)) continue;
      if (!Object.hasOwn(projected, property.id) && Object.hasOwn(value, property.label))
        projected[property.id] = structuredClone(value[property.label]!);
    }
  }
  const outputs = validateNodeOutputs(node, scope.flowId, projected);
  if (node.definition.executionClass === 'PURE_DATA') {
    if (parsed.control.length || parsed.effects.length || parsed.terminal)
      throw new Error(`Pure data node ${node.id} emitted control, effects, or a terminal`);
  }
  if (parsed.terminal)
    throw new Error(`Executor node ${node.id} cannot emit structural terminal ${parsed.terminal.type}`);

  return {
    control: [...parsed.control],
    outputs,
    effects: structuredClone(parsed.effects),
  };
}
