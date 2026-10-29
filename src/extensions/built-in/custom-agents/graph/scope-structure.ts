import type { FlowSignature, GraphEdge, GraphNode, JsonObject } from './contracts';
import { schemaValueType } from './schema-ports';

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Orders nodes so every data source comes before its targets, breaking ties by node ID.
 * Nodes caught in a data cycle are appended in ID order and reported through `cyclic`.
 */
export function dataDependencyOrder(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): { ordered: GraphNode[]; cyclic: boolean } {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (edge.kind !== 'DATA' || !nodeById.has(edge.source.nodeId) || !nodeById.has(edge.target.nodeId)) continue;
    const targets = outgoing.get(edge.source.nodeId)!;
    if (!targets.has(edge.target.nodeId)) {
      targets.add(edge.target.nodeId);
      indegree.set(edge.target.nodeId, indegree.get(edge.target.nodeId)! + 1);
    }
  }
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).sort((a, b) => compareText(a.id, b.id));
  const ordered: GraphNode[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    ordered.push(node);
    for (const target of [...outgoing.get(node.id)!].sort()) {
      const remaining = indegree.get(target)! - 1;
      indegree.set(target, remaining);
      if (remaining === 0) {
        ready.push(nodeById.get(target)!);
        ready.sort((a, b) => compareText(a.id, b.id));
      }
    }
  }
  const cyclic = ordered.length !== nodes.length;
  if (cyclic) {
    const placed = new Set(ordered);
    ordered.push(...[...nodes].filter((node) => !placed.has(node)).sort((a, b) => compareText(a.id, b.id)));
  }
  return { ordered, cyclic };
}

/**
 * The signature of a for-each body scope: it receives each item (typed from the items schema) and its index,
 * returns a value, and threads the accumulator through when one is enabled.
 */
export function forEachBodySignature(
  itemsSchema: JsonObject,
  accumulatorSchema: JsonObject | undefined,
): FlowSignature {
  const itemSchema =
    schemaValueType(itemsSchema) === 'ARRAY' &&
    itemsSchema.items !== null &&
    typeof itemsSchema.items === 'object' &&
    !Array.isArray(itemsSchema.items)
      ? itemsSchema.items
      : {};
  const accumulatorPort = accumulatorSchema && {
    id: 'accumulator',
    label: 'accumulator',
    required: true,
    cardinality: 'ONE' as const,
    schema: structuredClone(accumulatorSchema),
  };
  return {
    inputs: [
      { id: 'item', label: 'item', required: true, cardinality: 'ONE', schema: structuredClone(itemSchema) },
      { id: 'index', label: 'index', required: true, cardinality: 'ONE', schema: { type: 'number' } },
      ...(accumulatorPort ? [accumulatorPort] : []),
    ],
    outputs: [
      { id: 'value', label: 'value', required: false, cardinality: 'ONE', schema: {} },
      ...(accumulatorPort ? [{ ...accumulatorPort, schema: structuredClone(accumulatorSchema!) }] : []),
    ],
  };
}
