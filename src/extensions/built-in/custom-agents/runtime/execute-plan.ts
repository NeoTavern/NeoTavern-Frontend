import type { CompiledNodePlan, CompiledPresetPlan, CompiledScopePlan } from '../graph/plan-types';
import type { DataPortDefinition, NodeExecutionResult, GraphNodeEffect } from '../registry/node-definition';
import type { JsonObject, JsonValue } from '../graph/contracts';
import { jsonValueSchema } from '../graph/schemas';
import { InvocationExecutionContext, type GraphExecutionRequest, type IterationBinding } from './execution-context';
import { executeExecutorNode, validateBoundaryValue, validateNodeOutputs } from './execute-node';
import { executeForEach } from './iteration';
import type { RunDiagnostic } from './diagnostics';
import { executeSubflow, type ScopeCompletion, type ScopeRunner } from './subflows';

export type GraphExecutionSuccess = {
  status: 'COMPLETED';
  flowId: string;
  state: JsonObject;
  effects: GraphNodeEffect[];
  generationResponse?: string;
  diagnostics: readonly Readonly<RunDiagnostic>[];
};
export type GraphExecutionFailure = {
  status: 'FAILED' | 'CANCELLED';
  flowId: string;
  error: string;
  diagnostics: readonly Readonly<RunDiagnostic>[];
};
export type GraphExecutionResult = GraphExecutionSuccess | GraphExecutionFailure;

type InternalResult = NodeExecutionResult & {
  terminal?: { type: 'STOP' } | { type: 'RETURN'; outputs: Record<string, JsonValue> };
};

function dataPorts(node: CompiledNodePlan, direction: 'INPUT' | 'OUTPUT'): DataPortDefinition[] {
  const ports = direction === 'INPUT' ? node.inputs : node.outputs;
  return ports.filter((port): port is DataPortDefinition => port.kind === 'DATA');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonObjectValue(value: unknown, label: string): Record<string, JsonValue> {
  const parsed = jsonValueSchema.parse(value);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object')
    throw new Error(`${label} must be a JSON object`);
  return parsed;
}

function isCancelled(context: InvocationExecutionContext): boolean {
  return context.request.signal.aborted;
}

export async function executeGraphPlan(request: GraphExecutionRequest): Promise<GraphExecutionResult> {
  const flow = request.plan.agent.flows.find((candidate) => candidate.id === request.flowId);
  if (!flow || flow.kind !== 'TRIGGER') {
    return {
      status: 'FAILED',
      flowId: request.flowId,
      error: `Unknown trigger flow ${request.flowId}`,
      diagnostics: [],
    };
  }

  let invocation: InvocationExecutionContext;
  try {
    request.signal.throwIfAborted();
    validateBoundaryValue(request.plan.agent.configurationSchema, request.configuration, 'Agent configuration');
    invocation = new InvocationExecutionContext(request);
    invocation.cancellation();
  } catch (error) {
    return {
      status: request.signal.aborted ? 'CANCELLED' : 'FAILED',
      flowId: request.flowId,
      error: errorText(error),
      diagnostics: [],
    };
  }

  const runScope: ScopeRunner = async (
    plan: CompiledScopePlan,
    bindings: Record<string, JsonValue>,
    iteration?: IterationBinding,
  ): Promise<ScopeCompletion> => {
    invocation.cancellation();
    const scope = invocation.createScope(plan.id, bindings, iteration);
    const nodeById = new Map(plan.nodes.map((node) => [node.id, node]));
    const completion: { value: ScopeCompletion } = { value: { type: 'COMPLETED' } };
    const transition = (
      node: CompiledNodePlan,
      diagnostic: Omit<RunDiagnostic, 'flowId' | 'nodeId' | 'scopeInvocationId'>,
    ): void =>
      invocation.diagnostics.upsert({
        flowId: plan.id,
        scopeInvocationId: scope.scopeInvocationId,
        nodeId: node.id,
        ...diagnostic,
      });

    const executePure = async (node: CompiledNodePlan): Promise<void> => {
      const existing = scope.nodes.get(node.id);
      if (existing?.status === 'EXECUTED') return;
      if (existing?.status === 'EXECUTING') throw new Error(`Pure data dependency cycle at ${plan.id}/${node.id}`);
      if (node.definition.executionClass !== 'PURE_DATA')
        throw new Error(`Controlled output ${plan.id}/${node.id} is unavailable before execution`);
      scope.nodes.set(node.id, { status: 'EXECUTING', outputs: {} });
      transition(node, { status: 'RUNNING' });
      try {
        const inputs = await resolveInputs(node);
        const result = await executeExecutorNode(invocation, scope, node, inputs);
        const outputs = validateNodeOutputs(node, plan.id, result.outputs);
        scope.nodes.set(node.id, { status: 'EXECUTED', outputs });
        transition(node, { status: 'COMPLETED', output: outputs });
      } catch (error) {
        transition(node, {
          status: isCancelled(invocation) ? 'CANCELLED' : 'FAILED',
          error: errorText(error),
        });
        throw error;
      }
    };

    const resolveInputs = async (
      node: CompiledNodePlan,
      selectedControlPortId?: string,
    ): Promise<Record<string, JsonValue>> => {
      const result: Record<string, JsonValue> = {};
      const selectedMergeValuePort =
        node.definition.executionClass === 'MERGE_ANY' && selectedControlPortId?.startsWith('in.')
          ? `value.${selectedControlPortId.slice(3)}`
          : undefined;
      for (const port of dataPorts(node, 'INPUT')) {
        if (selectedMergeValuePort && port.id.startsWith('value.') && port.id !== selectedMergeValuePort) continue;
        const binding = node.inputBindings[port.id];
        let value: JsonValue | undefined;
        let available = false;
        if (binding?.kind === 'INLINE') {
          value = structuredClone(binding.value);
          available = true;
        } else if (binding?.kind === 'EDGE') {
          const source = nodeById.get(binding.sourceNodeId);
          if (!source) throw new Error(`Missing data source ${binding.sourceNodeId}`);
          if (!scope.nodes.has(source.id)) {
            if (source.definition.executionClass === 'PURE_DATA') await executePure(source);
            else
              throw new Error(
                `Controlled output ${plan.id}/${source.id}.${binding.sourcePortId} is unavailable before execution`,
              );
          }
          const sourceState = scope.nodes.get(source.id);
          if (sourceState?.status === 'EXECUTED' && Object.hasOwn(sourceState.outputs, binding.sourcePortId)) {
            value = structuredClone(sourceState.outputs[binding.sourcePortId]!);
            available = true;
          }
        }
        if (!available) {
          if (port.required) throw new Error(`Required input ${plan.id}/${node.id}.${port.id} is unavailable`);
          continue;
        }
        result[port.id] = validateBoundaryValue(port.schema, value!, `Input ${plan.id}/${node.id}.${port.id}`);
      }
      return result;
    };

    const structuralResult = async (
      node: CompiledNodePlan,
      selectedControlPortId?: string,
    ): Promise<InternalResult> => {
      const kind = node.definition.runtime.kind;
      if (kind === 'TRIGGER') {
        const event = jsonObjectValue(structuredClone(invocation.event), 'Trigger event');
        const outputs: Record<string, JsonValue> = {};
        for (const port of dataPorts(node, 'OUTPUT')) {
          if (port.id === 'event') outputs.event = structuredClone(event);
          else if (Object.hasOwn(event, port.id)) outputs[port.id] = structuredClone(event[port.id]!);
          else outputs[port.id] = null;
        }
        return { control: ['out'], outputs, effects: [] };
      }
      if (kind === 'SCOPE_ENTRY') {
        const outputs: Record<string, JsonValue> = {};
        for (const port of dataPorts(node, 'OUTPUT'))
          if (Object.hasOwn(scope.bindings, port.id)) outputs[port.id] = structuredClone(scope.bindings[port.id]!);
        return { control: ['out'], outputs, effects: [] };
      }
      if (kind === 'SCOPE_RETURN') {
        const inputs = await resolveInputs(node);
        return { control: [], outputs: {}, effects: [], terminal: { type: 'RETURN', outputs: inputs } };
      }
      if (kind === 'RUN_SUBFLOW') {
        const inputs = await resolveInputs(node);
        if (!node.targetPlan) throw new Error(`Run Flow node ${node.id} has no compiled target`);
        const outputs = await executeSubflow(invocation, node.targetPlan, inputs, runScope);
        return { control: ['out'], outputs, effects: [] };
      }
      if (kind === 'FOR_EACH') {
        const inputs = await resolveInputs(node);
        const outputs = await executeForEach(invocation, node, inputs, runScope);
        return { control: ['out'], outputs, effects: [] };
      }
      if (kind === 'STOP') {
        if (plan.id === flow.id && flow.trigger?.event === 'GENERATE_ASSISTANT')
          throw new Error('Assistant-generation flow stopped without a generation response');
        return { control: [], outputs: {}, effects: [], terminal: { type: 'STOP' } };
      }
      return executeExecutorNode(invocation, scope, node, await resolveInputs(node, selectedControlPortId));
    };

    const arrive = async (node: CompiledNodePlan, controlPortId?: string): Promise<boolean> => {
      invocation.cancellation();
      const executionClass = node.definition.executionClass;
      if (executionClass === 'PURE_DATA') throw new Error(`Pure data node ${node.id} received a control token`);
      if (executionClass === 'MERGE_ANY' || executionClass === 'MERGE_ALL') {
        if (!controlPortId) throw new Error(`Merge node ${node.id} was seeded without an input`);
        const arrivals = scope.mergeArrivals.get(node.id) ?? new Set<string>();
        if (arrivals.has(controlPortId))
          throw new Error(`Merge ${plan.id}/${node.id} received duplicate arrival on ${controlPortId}`);
        if (executionClass === 'MERGE_ANY' && arrivals.size > 0)
          throw new Error(`Merge Any ${plan.id}/${node.id} received a duplicate arrival`);
        arrivals.add(controlPortId);
        scope.mergeArrivals.set(node.id, arrivals);
        if (executionClass === 'MERGE_ALL' && arrivals.size === 1) transition(node, { status: 'RUNNING' });
        if (executionClass === 'MERGE_ALL') {
          const declared = node.inputs.filter((port) => port.kind === 'CONTROL').length;
          if (arrivals.size < declared) return false;
        }
      } else if (scope.nodes.has(node.id))
        throw new Error(`Node ${plan.id}/${node.id} executed more than once in its scope`);

      scope.nodes.set(node.id, { status: 'EXECUTING', outputs: {} });
      if (executionClass !== 'MERGE_ALL') transition(node, { status: 'RUNNING' });
      let result: InternalResult;
      let outputs: Record<string, JsonValue>;
      try {
        result = await structuralResult(node, controlPortId);
        invocation.cancellation();
        outputs = validateNodeOutputs(node, plan.id, result.outputs);
        invocation.effectState.apply(result.effects);
        if (result.effects.length > 0 && invocation.request.onEffectsApplied) {
          const applied = invocation.effectState.publish();
          await invocation.request.onEffectsApplied(applied.state, result.effects, applied.generationResponse);
        }
        scope.nodes.set(node.id, { status: 'EXECUTED', outputs });
      } catch (error) {
        transition(node, {
          status: isCancelled(invocation) ? 'CANCELLED' : 'FAILED',
          error: errorText(error),
        });
        throw error;
      }
      transition(node, { status: 'COMPLETED', output: outputs });

      if (result.terminal?.type === 'RETURN') {
        completion.value = { type: 'RETURN', outputs: structuredClone(result.terminal.outputs) };
        return true;
      }
      if (result.terminal?.type === 'STOP') {
        completion.value = { type: 'STOP' };
        return true;
      }
      for (const portId of result.control) {
        const edges = [...(node.outgoingControl[portId] ?? [])].sort((left, right) =>
          left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
        );
        for (const edge of edges) {
          const target = nodeById.get(edge.targetNodeId);
          if (!target) throw new Error(`Missing control target ${edge.targetNodeId}`);
          if (await arrive(target, edge.targetPortId)) return true;
        }
      }
      return false;
    };

    const start = plan.entryNodeId
      ? nodeById.get(plan.entryNodeId)
      : plan.nodes.find((node) => node.definition.runtime.kind === 'TRIGGER');
    if (!start) throw new Error(`Scope ${plan.id} has no entry node`);
    await arrive(start);

    for (const node of plan.nodes) {
      if (node.definition.executionClass !== 'MERGE_ALL') continue;
      const arrivals = scope.mergeArrivals.get(node.id);
      if (arrivals && scope.nodes.get(node.id)?.status !== 'EXECUTED') {
        const error = new Error(`Merge All ${plan.id}/${node.id} is incomplete (${arrivals.size} arrivals)`);
        transition(node, { status: 'FAILED', error: error.message });
        throw error;
      }
    }
    if (plan.returnNodeId && completion.value.type !== 'RETURN')
      throw new Error(`Scope ${plan.id} completed without scope.return`);

    // Only a successfully completed scope has a meaningful skipped set. An absent node
    // never executed or began a merge arrival in this deterministic scope invocation.
    invocation.cancellation();
    for (const node of plan.nodes)
      if (!scope.nodes.has(node.id) && !scope.mergeArrivals.has(node.id)) transition(node, { status: 'SKIPPED' });
    return completion.value;
  };

  try {
    const completion = await runScope(flow, {});
    invocation.cancellation();
    if (completion.type === 'STOP' && flow.trigger?.event === 'GENERATE_ASSISTANT')
      throw new Error('Assistant-generation flow stopped without a generation response');
    const applied = invocation.effectState.publish();
    if (flow.trigger?.event === 'GENERATE_ASSISTANT' && applied.generationResponse === undefined)
      throw new Error('Generation flow did not supply a response');
    return {
      status: 'COMPLETED',
      flowId: flow.id,
      ...applied,
      diagnostics: invocation.diagnostics.snapshot(),
    };
  } catch (error) {
    return {
      status: isCancelled(invocation) ? 'CANCELLED' : 'FAILED',
      flowId: flow.id,
      error: errorText(error),
      diagnostics: invocation.diagnostics.snapshot(),
    };
  }
}

export function findTriggerFlow(plan: CompiledPresetPlan, flowId: string) {
  return plan.agent.flows.find((flow) => flow.id === flowId && flow.kind === 'TRIGGER');
}
