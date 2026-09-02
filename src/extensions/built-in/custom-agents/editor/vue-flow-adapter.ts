import type { Edge, Node, ViewportTransform } from '@vue-flow/core';
import { GRAPH_NODE_MIN_HEIGHT, GRAPH_NODE_MIN_WIDTH } from '../graph/contracts';
import type {
  GraphAgent,
  GraphEdge,
  GraphFlow,
  GraphNode,
  FlowSignature,
  JsonObject,
  ScopeGraph,
} from '../graph/contracts';
import { arePortSchemasAssignable, schemaFromConstant, schemaValueType } from '../graph/schema-ports';
import type { RunOverlayRecord } from './editor-store';
import type {
  DataPortDefinition,
  NodePortContext,
  PortDefinition,
  ReadonlyNodeRegistry,
  ResolvedInputBinding,
} from '../registry/node-definition';

export type EditorPortDefinition = PortDefinition & { stale?: true };
export type ResolvedEditorNode = {
  node: GraphNode;
  inputs: EditorPortDefinition[];
  outputs: EditorPortDefinition[];
};
export type EditorNodeData = ResolvedEditorNode & {
  label: string;
  invalid: boolean;
  renderSize?: { width: number; height: number };
  runRecord?: RunOverlayRecord;
};
export type EditorEdgeData = { graphEdge: GraphEdge; invalid: boolean };
export type EditorViewport = { x: number; y: number; zoom: number };

const emptyViewport: EditorViewport = { x: 0, y: 0, zoom: 1 };

function asScopeGraph(value: unknown): ScopeGraph | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const object = value as JsonObject;
  return Array.isArray(object.nodes) && Array.isArray(object.edges) ? (object as ScopeGraph) : undefined;
}

function sourcePort(
  edge: GraphEdge | undefined,
  resolved: ReadonlyMap<string, ResolvedEditorNode>,
): DataPortDefinition | undefined {
  if (!edge) return undefined;
  const port = resolved.get(edge.source.nodeId)?.outputs.find((candidate) => candidate.id === edge.source.portId);
  return port?.kind === 'DATA' ? port : undefined;
}

export type EditorPortResolutionCache = Map<string, { fingerprint: string; resolved: ResolvedEditorNode }>;
type NodeRenderCacheEntry = {
  fingerprint: string;
  value: Node<EditorNodeData>;
  node: GraphNode;
  ports: ResolvedEditorNode;
  graphEdges: ScopeGraph['edges'];
  invalid: boolean;
  selected: boolean;
  runRecord?: RunOverlayRecord;
  renderSize?: { width: number; height: number };
};
type EdgeRenderCacheEntry = {
  fingerprint: string;
  value: Edge<EditorEdgeData>;
  edge: GraphEdge;
  graphNodes: ScopeGraph['nodes'];
  graphEdges: ScopeGraph['edges'];
  resolved: ReadonlyMap<string, ResolvedEditorNode>;
  invalid: boolean;
  selected: boolean;
};
export type VueFlowRenderCache = {
  nodes: Map<string, NodeRenderCacheEntry>;
  edges: Map<string, EdgeRenderCacheEntry>;
};

export function createVueFlowRenderCache(): VueFlowRenderCache {
  return { nodes: new Map(), edges: new Map() };
}

export function deriveForEachBodySignature(
  node: GraphNode,
  graph: ScopeGraph,
  resolved: ReadonlyMap<string, ResolvedEditorNode>,
): FlowSignature {
  const bindingSchema = (portId: string): JsonObject => {
    const edge = graph.edges.find(
      (candidate) =>
        candidate.kind === 'DATA' && candidate.target.nodeId === node.id && candidate.target.portId === portId,
    );
    const source = sourcePort(edge, resolved);
    if (source) return source.schema;
    return Object.hasOwn(node.inputValues, portId) ? schemaFromConstant(node.inputValues[portId]!) : {};
  };
  const itemsSchema = bindingSchema('items');
  const accumulatorSchema = bindingSchema('initialAccumulator');
  const accumulator = node.data.accumulator === true;
  return {
    inputs: [
      {
        id: 'item',
        label: 'item',
        required: true,
        cardinality: 'ONE',
        schema: isObject(itemsSchema.items) ? itemsSchema.items : {},
      },
      { id: 'index', label: 'index', required: true, cardinality: 'ONE', schema: { type: 'number' } },
      ...(accumulator
        ? [
            {
              id: 'accumulator',
              label: 'accumulator',
              required: true,
              cardinality: 'ONE' as const,
              schema: accumulatorSchema,
            },
          ]
        : []),
    ],
    outputs: [
      { id: 'value', label: 'value', required: false, cardinality: 'ONE', schema: {} },
      ...(accumulator
        ? [
            {
              id: 'accumulator',
              label: 'accumulator',
              required: true,
              cardinality: 'ONE' as const,
              schema: accumulatorSchema,
            },
          ]
        : []),
    ],
  };
}

export function resolveEditorScope(
  agent: GraphAgent,
  flow: GraphFlow,
  scopePath: readonly string[],
  registry: ReadonlyNodeRegistry,
  cache: EditorPortResolutionCache = new Map(),
): { graph: ScopeGraph; signature: FlowSignature; resolved: Map<string, ResolvedEditorNode> } | undefined {
  let graph: ScopeGraph = flow;
  let signature: FlowSignature = { inputs: flow.inputs, outputs: flow.outputs };
  let signatureKind: NodePortContext['scopeSignatureKind'] = 'AUTHORED';
  let resolved = resolveEditorPorts(agent, flow, graph, registry, signature, cache, signatureKind);
  for (const ownerId of scopePath) {
    const owner = graph.nodes.find((node) => node.id === ownerId);
    const body = owner && asScopeGraph(owner.data.body);
    if (!owner || owner.type !== 'control.for-each' || !body) return undefined;
    signature = deriveForEachBodySignature(owner, graph, resolved);
    signatureKind = 'FOR_EACH';
    graph = body;
    resolved = resolveEditorPorts(agent, flow, graph, registry, signature, cache, signatureKind);
  }
  return { graph, signature, resolved };
}

export function resolveEditorPorts(
  agent: GraphAgent,
  flow: GraphFlow,
  graph: ScopeGraph,
  registry: ReadonlyNodeRegistry,
  signature = { inputs: flow.inputs, outputs: flow.outputs },
  cache: EditorPortResolutionCache = new Map(),
  scopeSignatureKind: NodePortContext['scopeSignatureKind'] = 'AUTHORED',
): Map<string, ResolvedEditorNode> {
  let resolved = new Map<string, ResolvedEditorNode>(
    graph.nodes.flatMap((node) => {
      const cached = cache.get(node.id);
      return cached ? [[node.id, { ...cached.resolved, node }] as const] : [];
    }),
  );
  for (let pass = 0; pass <= graph.nodes.length; pass++) {
    const next = new Map<string, ResolvedEditorNode>();
    for (const node of graph.nodes) {
      const definition = registry.get(node.type);
      const parsed = definition?.dataSchema.safeParse(node.data);
      if (!definition || !parsed?.success) {
        next.set(node.id, { node, inputs: [], outputs: [] });
        continue;
      }
      const binding = (portId: string): ResolvedInputBinding => {
        const incoming = graph.edges.find(
          (edge) => edge.kind === 'DATA' && edge.target.nodeId === node.id && edge.target.portId === portId,
        );
        const source = sourcePort(incoming, resolved);
        if (source) return { kind: 'EDGE', source };
        if (Object.hasOwn(node.inputValues, portId)) return { kind: 'INLINE', value: node.inputValues[portId]! };
        return { kind: 'UNBOUND' };
      };
      const nestedSources = new Map<string, DataPortDefinition>();
      if (node.type === 'control.for-each') {
        const body = asScopeGraph(node.data.body);
        if (body) {
          const bodySignature = deriveForEachBodySignature(node, graph, resolved);
          const bodyResolved = resolveEditorPorts(agent, flow, body, registry, bodySignature, cache, 'FOR_EACH');
          const returned = body.nodes.find((candidate) => candidate.type === 'scope.return');
          if (returned)
            for (const returnPort of bodySignature.outputs) {
              const edge = body.edges.find(
                (candidate) =>
                  candidate.kind === 'DATA' &&
                  candidate.target.nodeId === returned.id &&
                  candidate.target.portId === returnPort.id,
              );
              const source = sourcePort(edge, bodyResolved);
              if (source) nestedSources.set(returnPort.id, source);
            }
        }
      }
      try {
        const dependencyFingerprint = graph.edges
          .filter((edge) => edge.target.nodeId === node.id)
          .map((edge) => [
            edge,
            resolved.get(edge.source.nodeId)?.outputs.find((port) => port.id === edge.source.portId),
          ])
          .map(([edge, port]) => `${JSON.stringify(edge)}:${JSON.stringify(port)}`)
          .sort()
          .join('|');
        const fingerprint = JSON.stringify([
          node.type,
          node.data,
          node.inputValues,
          dependencyFingerprint,
          signature,
          scopeSignatureKind,
          agent.configurationSchema,
          agent.stateSchema,
          agent.flows.map(({ id, inputs, outputs }) => ({ id, inputs, outputs })),
        ]);
        const cached = cache.get(node.id);
        if (cached?.fingerprint === fingerprint) {
          next.set(node.id, { ...cached.resolved, node });
          continue;
        }
        const ports = definition.ports(parsed.data, {
          agent,
          flow,
          nodeId: node.id,
          scopeSignature: signature,
          scopeSignatureKind,
          resolveSubflow: (flowId) => agent.flows.find((candidate) => candidate.id === flowId),
          resolveInputBinding: binding,
          resolveNestedReturnSource: (portId) => nestedSources.get(portId),
        });
        const result = { node, inputs: ports.inputs, outputs: ports.outputs };
        cache.set(node.id, { fingerprint, resolved: result });
        next.set(node.id, result);
      } catch {
        next.set(node.id, { node, inputs: [], outputs: [] });
      }
    }
    resolved = next;
  }
  return resolved;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isValidConnection(
  edge: Pick<GraphEdge, 'kind' | 'source' | 'target'>,
  graph: ScopeGraph,
  ports: ReadonlyMap<string, ResolvedEditorNode>,
  ignoreEdgeId?: string,
): boolean {
  if (edge.source.nodeId === edge.target.nodeId) return false;
  const source = ports.get(edge.source.nodeId)?.outputs.find((port) => port.id === edge.source.portId);
  const target = ports.get(edge.target.nodeId)?.inputs.find((port) => port.id === edge.target.portId);
  if (!source || !target || source.kind !== edge.kind || target.kind !== edge.kind) return false;
  if (source.direction !== 'OUTPUT' || target.direction !== 'INPUT') return false;
  if (edge.kind === 'DATA' && source.kind === 'DATA' && target.kind === 'DATA') {
    if (!arePortSchemasAssignable(source.schema, target.schema)) return false;
  }
  const duplicate = graph.edges.some(
    (candidate) =>
      candidate.id !== ignoreEdgeId &&
      candidate.kind === edge.kind &&
      candidate.source.nodeId === edge.source.nodeId &&
      candidate.source.portId === edge.source.portId &&
      candidate.target.nodeId === edge.target.nodeId &&
      candidate.target.portId === edge.target.portId,
  );
  const occupied = graph.edges.some(
    (candidate) =>
      candidate.id !== ignoreEdgeId &&
      candidate.target.nodeId === edge.target.nodeId &&
      candidate.target.portId === edge.target.portId,
  );
  return !duplicate && !occupied;
}

export function toVueFlow(
  graph: ScopeGraph,
  resolved: ReadonlyMap<string, ResolvedEditorNode>,
  invalidNodeIds: ReadonlySet<string>,
  invalidEdgeIds: ReadonlySet<string>,
  runStatuses: Readonly<Record<string, EditorNodeData['runRecord']>> = {},
  selectedNodeIds: ReadonlySet<string> = new Set(),
  selectedEdgeId?: string,
  cache: VueFlowRenderCache = createVueFlowRenderCache(),
  previewSizes: Readonly<Record<string, { width: number; height: number }>> = {},
): { nodes: Node<EditorNodeData>[]; edges: Edge<EditorEdgeData>[] } {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  for (const id of cache.nodes.keys()) if (!nodeIds.has(id)) cache.nodes.delete(id);
  for (const id of cache.edges.keys()) if (!edgeIds.has(id)) cache.edges.delete(id);
  return {
    nodes: graph.nodes.map((node) => {
      const ports = resolved.get(node.id) ?? { node, inputs: [], outputs: [] };
      const invalid = invalidNodeIds.has(node.id);
      const selected = selectedNodeIds.has(node.id);
      const runRecord = runStatuses[node.id];
      const renderSize = previewSizes[node.id] ?? node.size;
      const cached = cache.nodes.get(node.id);
      if (
        cached?.node === node &&
        cached.ports === ports &&
        cached.graphEdges === graph.edges &&
        cached.invalid === invalid &&
        cached.selected === selected &&
        cached.runRecord === runRecord &&
        cached.renderSize === renderSize
      )
        return cached.value;
      const inputs = [...ports.inputs];
      const outputs = [...ports.outputs];
      for (const edge of graph.edges) {
        if (edge.target.nodeId === node.id && !inputs.some((port) => port.id === edge.target.portId))
          inputs.push(
            edge.kind === 'CONTROL'
              ? {
                  id: edge.target.portId,
                  direction: 'INPUT',
                  kind: 'CONTROL',
                  cardinality: 'ONE',
                  labelKey: edge.target.portId,
                  literalLabel: true,
                  stale: true,
                }
              : {
                  id: edge.target.portId,
                  direction: 'INPUT',
                  kind: 'DATA',
                  cardinality: 'ONE',
                  required: false,
                  schema: {},
                  labelKey: edge.target.portId,
                  literalLabel: true,
                  stale: true,
                },
          );
        if (edge.source.nodeId === node.id && !outputs.some((port) => port.id === edge.source.portId))
          outputs.push(
            edge.kind === 'CONTROL'
              ? {
                  id: edge.source.portId,
                  direction: 'OUTPUT',
                  kind: 'CONTROL',
                  cardinality: 'MANY',
                  labelKey: edge.source.portId,
                  literalLabel: true,
                  stale: true,
                }
              : {
                  id: edge.source.portId,
                  direction: 'OUTPUT',
                  kind: 'DATA',
                  cardinality: 'MANY',
                  required: false,
                  schema: {},
                  labelKey: edge.source.portId,
                  literalLabel: true,
                  stale: true,
                },
          );
      }
      const fingerprint = JSON.stringify([node, inputs, outputs, invalid, runRecord, selected, renderSize]);
      if (cached?.fingerprint === fingerprint) {
        cache.nodes.set(node.id, {
          ...cached,
          node,
          ports,
          graphEdges: graph.edges,
          invalid,
          selected,
          runRecord,
          renderSize,
        });
        return cached.value;
      }
      const value = {
        id: node.id,
        type: 'graph',
        position: { ...node.position },
        width: Math.max(GRAPH_NODE_MIN_WIDTH, renderSize?.width ?? GRAPH_NODE_MIN_WIDTH),
        ...(renderSize ? { height: Math.max(GRAPH_NODE_MIN_HEIGHT, renderSize.height) } : {}),
        selected,
        data: {
          ...ports,
          node,
          inputs,
          outputs,
          label: node.type,
          invalid,
          ...(renderSize ? { renderSize } : {}),
          ...(runRecord ? { runRecord } : {}),
        },
      } as Node<EditorNodeData>;
      cache.nodes.set(node.id, {
        fingerprint,
        value,
        node,
        ports,
        graphEdges: graph.edges,
        invalid,
        selected,
        runRecord,
        renderSize,
      });
      return value;
    }),
    edges: graph.edges.map((edge) => {
      const selected = edge.id === selectedEdgeId;
      const cached = cache.edges.get(edge.id);
      if (
        cached?.edge === edge &&
        cached.graphNodes === graph.nodes &&
        cached.graphEdges === graph.edges &&
        cached.resolved === resolved &&
        cached.invalid === invalidEdgeIds.has(edge.id) &&
        cached.selected === selected
      )
        return cached.value;
      const invalid = invalidEdgeIds.has(edge.id) || !isValidConnection(edge, graph, resolved, edge.id);
      const fingerprint = JSON.stringify([edge, invalid, selected]);
      if (cached?.fingerprint === fingerprint) {
        cache.edges.set(edge.id, {
          ...cached,
          edge,
          graphNodes: graph.nodes,
          graphEdges: graph.edges,
          resolved,
          invalid,
          selected,
        });
        return cached.value;
      }
      const value = {
        id: edge.id,
        source: edge.source.nodeId,
        sourceHandle: edge.source.portId,
        target: edge.target.nodeId,
        targetHandle: edge.target.portId,
        type: 'default',
        animated: edge.kind === 'CONTROL',
        selected,
        class: invalid ? 'custom-agent-flow__edge--invalid' : `custom-agent-flow__edge--${edge.kind.toLowerCase()}`,
        data: { graphEdge: edge, invalid },
      } as Edge<EditorEdgeData>;
      cache.edges.set(edge.id, {
        fingerprint,
        value,
        edge,
        graphNodes: graph.nodes,
        graphEdges: graph.edges,
        resolved,
        invalid,
        selected,
      });
      return value;
    }),
  };
}

export function fromVueFlow(
  original: ScopeGraph,
  nodes: readonly Node<EditorNodeData>[],
  edges: readonly Edge<EditorEdgeData>[],
): ScopeGraph {
  const originalNodes = new Map(original.nodes.map((node) => [node.id, node]));
  const originalEdges = new Map(original.edges.map((edge) => [edge.id, edge]));
  return {
    nodes: nodes.flatMap((node) => {
      const serialized = originalNodes.get(node.id) ?? node.data?.node;
      return serialized ? [{ ...structuredClone(serialized), position: { ...node.position } }] : [];
    }),
    edges: edges.flatMap((edge) => {
      const serialized = originalEdges.get(edge.id) ?? edge.data?.graphEdge;
      return serialized ? [structuredClone(serialized)] : [];
    }),
  };
}

export function nodePositionsFromVue(nodes: readonly Node[]): Record<string, { x: number; y: number }> {
  return Object.fromEntries(nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]));
}

export function viewportFromVue(viewport?: ViewportTransform): EditorViewport {
  return viewport ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom } : { ...emptyViewport };
}

export function portTypeLabel(port: PortDefinition): string {
  return port.kind === 'CONTROL' ? 'CONTROL' : schemaValueType(port.schema);
}
