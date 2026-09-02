import type { CompiledNodePlan } from '../graph/plan-types';
import type { JsonValue } from '../graph/contracts';
import type { InvocationExecutionContext } from './execution-context';
import { validateBoundaryValue } from './execute-node';
import type { ScopeRunner } from './subflows';

export async function executeForEach(
  invocation: InvocationExecutionContext,
  node: CompiledNodePlan,
  inputs: Readonly<Record<string, JsonValue>>,
  runScope: ScopeRunner,
): Promise<Record<string, JsonValue>> {
  if (!node.bodyPlan) throw new Error(`For Each node ${node.id} has no compiled body`);
  const source = inputs.items;
  if (!Array.isArray(source)) throw new Error(`For Each node ${node.id} requires an items array`);
  const accumulatorEnabled = node.bodyPlan.signature.inputs.some((port) => port.id === 'accumulator');
  let accumulator: JsonValue | undefined;
  if (accumulatorEnabled) {
    if (!Object.hasOwn(inputs, 'initialAccumulator'))
      throw new Error(`For Each node ${node.id} requires an initial accumulator`);
    accumulator = structuredClone(inputs.initialAccumulator ?? null);
  }
  const returnedItems: JsonValue[] = [];

  for (const [index, item] of source.entries()) {
    invocation.cancellation();
    const bodyBindings: Record<string, JsonValue> = {
      item: structuredClone(item),
      index,
      ...(accumulatorEnabled ? { accumulator: structuredClone(accumulator!) } : {}),
    };
    const completion = await runScope(node.bodyPlan, bodyBindings, {
      item: structuredClone(item),
      index,
      ...(accumulatorEnabled ? { accumulator: structuredClone(accumulator!) } : {}),
    });
    invocation.cancellation();
    if (completion.type !== 'RETURN') throw new Error(`For Each body ${node.bodyPlan.id} did not reach scope.return`);
    if (Object.hasOwn(completion.outputs, 'value')) returnedItems.push(structuredClone(completion.outputs.value!));
    if (accumulatorEnabled) {
      if (!Object.hasOwn(completion.outputs, 'accumulator'))
        throw new Error(`For Each body ${node.bodyPlan.id} did not return its required accumulator`);
      const schema = node.bodyPlan.signature.outputs.find((port) => port.id === 'accumulator')!.schema;
      accumulator = validateBoundaryValue(
        schema,
        completion.outputs.accumulator!,
        `Accumulator returned by ${node.bodyPlan.id}`,
      );
    }
  }

  return {
    items: returnedItems,
    ...(accumulatorEnabled ? { accumulator: structuredClone(accumulator!) } : {}),
  };
}
