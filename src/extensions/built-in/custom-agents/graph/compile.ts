import type { ReadonlyNodeRegistry } from '../registry/node-definition';
import type { GraphDiagnostic } from './diagnostics';
import type {
  CompiledFlowPlan,
  CompiledNodePlan,
  CompiledPresetPlan,
  CompiledScopePlan,
  ValidatedGraphPreset,
} from './plan-types';
import { validateGraphPreset } from './validate';

export type GraphCompileResult =
  | { success: true; plan: CompiledPresetPlan }
  | { success: false; diagnostics: GraphDiagnostic[] };

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'definition') deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

export function compileValidatedGraph(validated: ValidatedGraphPreset): CompiledPresetPlan {
  const baseById = new Map(validated.resolvedFlows.map((flow) => [flow.id, flow]));
  const compiledById = new Map<string, CompiledFlowPlan>();
  const building = new Set<string>();

  const attachScope = (scope: CompiledScopePlan): CompiledScopePlan => ({
    ...scope,
    nodes: scope.nodes.map(attachNode),
  });
  const attachNode = (node: CompiledNodePlan): CompiledNodePlan => {
    Object.freeze(node.definition.runtime);
    Object.freeze(node.definition);
    return {
      ...node,
      ...(node.targetFlowId ? { targetPlan: buildFlow(node.targetFlowId) } : {}),
      ...(node.bodyPlan ? { bodyPlan: attachScope(node.bodyPlan) } : {}),
    };
  };
  const buildFlow = (flowId: string): CompiledFlowPlan => {
    const existing = compiledById.get(flowId);
    if (existing) return existing;
    if (building.has(flowId)) throw new Error(`Subflow call cycle involving ${flowId}`);
    const base = baseById.get(flowId);
    if (!base) throw new Error(`Missing compiled flow ${flowId}`);
    building.add(flowId);
    const compiled: CompiledFlowPlan = { ...base, nodes: base.nodes.map(attachNode) };
    building.delete(flowId);
    compiledById.set(flowId, compiled);
    return compiled;
  };

  const flows = [...baseById.keys()].sort().map(buildFlow);
  return deepFreeze({
    format: 'NEOTAVERN_CUSTOM_AGENT_FLOW',
    agent: {
      id: validated.preset.agent.id,
      name: validated.preset.agent.name,
      enabled: validated.preset.agent.enabled,
      priority: validated.preset.agent.priority,
      configurationSchema: structuredClone(validated.preset.agent.configurationSchema),
      stateSchema: structuredClone(validated.preset.agent.stateSchema),
      flows,
    },
  });
}

export function compileGraphPreset(value: unknown, registry: ReadonlyNodeRegistry): GraphCompileResult {
  const checked = validateGraphPreset(value, registry);
  return checked.valid
    ? { success: true, plan: compileValidatedGraph(checked.value) }
    : { success: false, diagnostics: checked.diagnostics };
}
