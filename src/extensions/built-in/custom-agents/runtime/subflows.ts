import type { CompiledFlowPlan, CompiledScopePlan } from '../graph/plan-types';
import type { JsonValue } from '../graph/contracts';
import type { InvocationExecutionContext, IterationBinding } from './execution-context';

export type ScopeCompletion =
  | { type: 'COMPLETED' }
  | { type: 'RETURN'; outputs: Record<string, JsonValue> }
  | { type: 'STOP' };

export type ScopeRunner = (
  plan: CompiledFlowPlan | CompiledScopePlan,
  bindings: Record<string, JsonValue>,
  iteration?: IterationBinding,
) => Promise<ScopeCompletion>;

export async function executeSubflow(
  invocation: InvocationExecutionContext,
  target: CompiledFlowPlan,
  bindings: Record<string, JsonValue>,
  runScope: ScopeRunner,
): Promise<Record<string, JsonValue>> {
  invocation.cancellation();
  const completion = await runScope(target, bindings);
  invocation.cancellation();
  if (completion.type !== 'RETURN') throw new Error(`Subflow ${target.id} completed without reaching scope.return`);
  return structuredClone(completion.outputs);
}
