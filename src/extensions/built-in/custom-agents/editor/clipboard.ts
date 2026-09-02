import type { GraphEdge, GraphNode, JsonObject, ScopeGraph } from '../graph/contracts';
import type { IdSource } from '../registry/node-definition';

export type GraphClipboard = Readonly<{
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}>;

function remapScope(scope: ScopeGraph, generate: () => string): ScopeGraph {
  const nodeIds = new Map(scope.nodes.map((node) => [node.id, generate()]));
  const nodes = scope.nodes.map((node) => {
    const data = structuredClone(node.data);
    if (node.type === 'control.for-each' && isScopeGraph(data.body)) data.body = remapScope(data.body, generate);
    return { ...structuredClone(node), id: nodeIds.get(node.id)!, data };
  });
  const edges = scope.edges.map((edge) => ({
    ...structuredClone(edge),
    id: generate(),
    source: { ...edge.source, nodeId: nodeIds.get(edge.source.nodeId)! },
    target: { ...edge.target, nodeId: nodeIds.get(edge.target.nodeId)! },
  }));
  return { nodes, edges };
}

function isScopeGraph(value: unknown): value is ScopeGraph {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const object = value as JsonObject;
  return Array.isArray(object.nodes) && Array.isArray(object.edges);
}

export function copySelection(graph: ScopeGraph, selectedNodeIds: ReadonlySet<string>): GraphClipboard {
  const nodes = graph.nodes.filter((node) => selectedNodeIds.has(node.id)).map((node) => structuredClone(node));
  const included = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => included.has(edge.source.nodeId) && included.has(edge.target.nodeId))
    .map((edge) => structuredClone(edge));
  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) });
}

export function pasteClipboard(
  clipboard: GraphClipboard,
  existingAgentNodeIds: ReadonlySet<string>,
  ids: IdSource,
  offset = { x: 32, y: 32 },
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const generated = new Set<string>();
  const generate = (): string => {
    let next = ids.generate();
    while (existingAgentNodeIds.has(next) || generated.has(next)) next = ids.generate();
    generated.add(next);
    return next;
  };
  const remapped = remapScope({ nodes: [...clipboard.nodes], edges: [...clipboard.edges] }, generate);
  return {
    nodes: remapped.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
    })),
    edges: remapped.edges,
  };
}
