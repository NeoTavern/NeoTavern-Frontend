import { GRAPH_NODE_MIN_HEIGHT, GRAPH_NODE_MIN_WIDTH, type GraphEdge, type ScopeGraph } from '../graph/contracts';

export const SMART_LAYOUT_HORIZONTAL_GAP = 96;
export const SMART_LAYOUT_VERTICAL_GAP = 48;
export const SMART_LAYOUT_COMPONENT_GAP = 96;

export type SmartLayoutDimensions = Readonly<Record<string, { width: number; height: number }>>;
export type SmartLayoutPortOrders = Readonly<Record<string, { inputs: readonly string[]; outputs: readonly string[] }>>;
export type SmartLayoutAvailability = { available: true } | { available: false; reason: 'CYCLIC' };
export type SmartLayoutResult =
  | { available: true; positions: Readonly<Record<string, { x: number; y: number }>> }
  | { available: false; reason: 'CYCLIC' }
  | { available: false; reason: 'UNMEASURED'; nodeIds: readonly string[] };

type LayoutNode = {
  id: string;
  index: number;
  width: number;
  height: number;
  rank: number;
};

type Neighbor = { id: string; kind: GraphEdge['kind']; portOffset: number };

function stableNodeCompare(left: LayoutNode, right: LayoutNode): number {
  return left.index - right.index || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function internalEdges(graph: ScopeGraph, nodeIds: ReadonlySet<string>): GraphEdge[] {
  return graph.edges.filter((edge) => nodeIds.has(edge.source.nodeId) && nodeIds.has(edge.target.nodeId));
}

function topologicalOrder(nodes: readonly LayoutNode[], edges: readonly GraphEdge[]): LayoutNode[] | undefined {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    indegree.set(edge.target.nodeId, indegree.get(edge.target.nodeId)! + 1);
    outgoing.get(edge.source.nodeId)!.push(edge.target.nodeId);
  }
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).sort(stableNodeCompare);
  const ordered: LayoutNode[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    ordered.push(node);
    for (const targetId of outgoing.get(node.id)!) {
      const next = indegree.get(targetId)! - 1;
      indegree.set(targetId, next);
      if (next === 0) {
        ready.push(byId.get(targetId)!);
        ready.sort(stableNodeCompare);
      }
    }
  }
  return ordered.length === nodes.length ? ordered : undefined;
}

export function smartLayoutAvailability(graph: ScopeGraph): SmartLayoutAvailability {
  const nodes = graph.nodes.map((node, index) => ({
    id: node.id,
    index,
    width: GRAPH_NODE_MIN_WIDTH,
    height: GRAPH_NODE_MIN_HEIGHT,
    rank: 0,
  }));
  const ids = new Set(nodes.map((node) => node.id));
  return topologicalOrder(nodes, internalEdges(graph, ids))
    ? { available: true }
    : { available: false, reason: 'CYCLIC' };
}

function weakComponents(nodes: readonly LayoutNode[], edges: readonly GraphEdge[]): LayoutNode[][] {
  const adjacent = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    adjacent.get(edge.source.nodeId)!.add(edge.target.nodeId);
    adjacent.get(edge.target.nodeId)!.add(edge.source.nodeId);
  }
  const remaining = new Set(nodes.map((node) => node.id));
  const components: LayoutNode[][] = [];
  for (const start of [...nodes].sort(stableNodeCompare)) {
    if (!remaining.delete(start.id)) continue;
    const component: LayoutNode[] = [];
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift()!;
      component.push(byId.get(id)!);
      const neighbors = [...adjacent.get(id)!].map((neighborId) => byId.get(neighborId)!).sort(stableNodeCompare);
      for (const neighbor of neighbors) {
        if (remaining.delete(neighbor.id)) queue.push(neighbor.id);
      }
    }
    components.push(component.sort(stableNodeCompare));
  }
  return components;
}

function neighborScore(
  node: LayoutNode,
  neighbors: ReadonlyMap<string, readonly Neighbor[]>,
  orderById: ReadonlyMap<string, number>,
  median: boolean,
): { value: number; control: boolean } | undefined {
  const all = neighbors.get(node.id) ?? [];
  const control = all.filter((neighbor) => neighbor.kind === 'CONTROL');
  const prioritized = control.length ? control : all;
  const values = prioritized
    .map((neighbor) => {
      const order = orderById.get(neighbor.id);
      return order === undefined ? undefined : order + neighbor.portOffset;
    })
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right);
  if (!values.length) return undefined;
  if (!median)
    return { value: values.reduce((sum, value) => sum + value, 0) / values.length, control: !!control.length };
  const middle = Math.floor(values.length / 2);
  return {
    value: values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2,
    control: !!control.length,
  };
}

function reorderLayer(
  layer: LayoutNode[],
  orderById: ReadonlyMap<string, number>,
  neighbors: ReadonlyMap<string, readonly Neighbor[]>,
  median: boolean,
): void {
  layer.sort((left, right) => {
    const leftScore = neighborScore(left, neighbors, orderById, median);
    const rightScore = neighborScore(right, neighbors, orderById, median);
    if (leftScore && rightScore) {
      const score = leftScore.value - rightScore.value;
      if (score) return score;
      if (leftScore.control !== rightScore.control) return leftScore.control ? -1 : 1;
    } else if (leftScore || rightScore) {
      return leftScore ? -1 : 1;
    }
    return stableNodeCompare(left, right);
  });
}

function portOffset(portId: string, order: readonly string[] | undefined): number {
  const index = order?.indexOf(portId) ?? -1;
  if (index < 0 || !order?.length) return 0;
  // Keep port order as tie information without allowing it to outweigh an adjacent node's layer order.
  return ((index + 1) / (order.length + 1) - 0.5) * 0.5;
}

function layoutComponent(
  component: readonly LayoutNode[],
  edges: readonly GraphEdge[],
  portOrders: SmartLayoutPortOrders,
): { positions: Record<string, { x: number; y: number }>; height: number } {
  const ids = new Set(component.map((node) => node.id));
  const componentEdges = edges.filter((edge) => ids.has(edge.source.nodeId) && ids.has(edge.target.nodeId));
  const incoming = new Map(component.map((node) => [node.id, [] as Neighbor[]]));
  const outgoing = new Map(component.map((node) => [node.id, [] as Neighbor[]]));
  for (const edge of componentEdges) {
    incoming.get(edge.target.nodeId)!.push({
      id: edge.source.nodeId,
      kind: edge.kind,
      portOffset: portOffset(edge.source.portId, portOrders[edge.source.nodeId]?.outputs),
    });
    outgoing.get(edge.source.nodeId)!.push({
      id: edge.target.nodeId,
      kind: edge.kind,
      portOffset: portOffset(edge.target.portId, portOrders[edge.target.nodeId]?.inputs),
    });
  }
  const maxRank = Math.max(0, ...component.map((node) => node.rank));
  const layers = Array.from({ length: maxRank + 1 }, () => [] as LayoutNode[]);
  for (const node of component) layers[node.rank]!.push(node);
  for (const layer of layers) layer.sort(stableNodeCompare);

  const currentOrder = () => new Map(layers.flatMap((layer) => layer.map((node, index) => [node.id, index] as const)));
  for (let pass = 0; pass < 6; pass++) {
    for (let rank = 1; rank <= maxRank; rank++) reorderLayer(layers[rank]!, currentOrder(), incoming, pass % 2 === 0);
    for (let rank = maxRank - 1; rank >= 0; rank--)
      reorderLayer(layers[rank]!, currentOrder(), outgoing, pass % 2 !== 0);
  }

  const rankX: number[] = [0];
  for (let rank = 1; rank <= maxRank; rank++) {
    const previousWidth = Math.max(...layers[rank - 1]!.map((node) => node.width));
    rankX[rank] = rankX[rank - 1]! + previousWidth + SMART_LAYOUT_HORIZONTAL_GAP;
  }
  const positions: Record<string, { x: number; y: number }> = {};
  let componentHeight = 0;
  for (let rank = 0; rank <= maxRank; rank++) {
    let y = 0;
    for (const node of layers[rank]!) {
      positions[node.id] = { x: rankX[rank]!, y };
      y += node.height + SMART_LAYOUT_VERTICAL_GAP;
    }
    componentHeight = Math.max(componentHeight, Math.max(0, y - SMART_LAYOUT_VERTICAL_GAP));
  }
  return { positions, height: componentHeight };
}

export function smartLayout(
  graph: ScopeGraph,
  dimensions: SmartLayoutDimensions = {},
  portOrders: SmartLayoutPortOrders = {},
): SmartLayoutResult {
  const nodes: LayoutNode[] = graph.nodes.map((node, index) => {
    const measured = dimensions[node.id];
    return {
      id: node.id,
      index,
      width: measured?.width ?? 0,
      height: measured?.height ?? 0,
      rank: 0,
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  const edges = internalEdges(graph, ids);
  const ordered = topologicalOrder(nodes, edges);
  if (!ordered) return { available: false, reason: 'CYCLIC' };
  const unmeasured = nodes
    .filter(
      (node) => !Number.isFinite(node.width) || !Number.isFinite(node.height) || node.width <= 0 || node.height <= 0,
    )
    .map((node) => node.id);
  if (unmeasured.length) return { available: false, reason: 'UNMEASURED', nodeIds: unmeasured };
  for (const node of nodes) {
    node.width = Math.max(GRAPH_NODE_MIN_WIDTH, node.width);
    node.height = Math.max(GRAPH_NODE_MIN_HEIGHT, node.height);
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of ordered) {
    for (const edge of edges) {
      if (edge.source.nodeId !== node.id) continue;
      const target = byId.get(edge.target.nodeId)!;
      target.rank = Math.max(target.rank, node.rank + 1);
    }
  }

  const positions: Record<string, { x: number; y: number }> = {};
  let componentY = 0;
  for (const component of weakComponents(nodes, edges)) {
    const laidOut = layoutComponent(component, edges, portOrders);
    for (const [id, position] of Object.entries(laidOut.positions)) {
      positions[id] = { x: position.x, y: position.y + componentY };
    }
    componentY += laidOut.height + SMART_LAYOUT_COMPONENT_GAP;
  }
  return { available: true, positions };
}
