import { computed, shallowRef, triggerRef, type ComputedRef, type ShallowRef } from 'vue';
import { compileGraphPreset } from '../graph/compile';
import { GRAPH_NODE_MIN_HEIGHT, GRAPH_NODE_MIN_WIDTH } from '../graph/contracts';
import type { GraphDiagnostic } from '../graph/diagnostics';
import type {
  GraphEdge,
  GraphFlow,
  FlowPortDeclaration,
  GraphNode,
  GraphPreset,
  JsonObject,
  JsonValue,
  ScopeGraph,
} from '../graph/contracts';
import type { IdSource, ReadonlyNodeRegistry } from '../registry/node-definition';
import { copySelection, pasteClipboard, type GraphClipboard } from './clipboard';
import { CommandHistory } from './history';
import { resolveEditorScope } from './vue-flow-adapter';

export type EditorViewport = { x: number; y: number; zoom: number };
export type ScopeLayoutPositions = {
  flowId: string;
  scopePath: readonly string[];
  positions: Readonly<Record<string, { x: number; y: number }>>;
};
type NodePosition = GraphNode['position'];
type NodeSize = NonNullable<GraphNode['size']>;
type GeometryPatch =
  | {
      kind: 'position';
      flowId: string;
      scopePath: readonly string[];
      nodeId: string;
      before: NodePosition;
      after: NodePosition;
    }
  | {
      kind: 'size';
      flowId: string;
      scopePath: readonly string[];
      nodeId: string;
      before: NodeSize | undefined;
      after: NodeSize;
    };
export type RunOverlayInvocation = {
  scopeInvocationId: string;
  status: 'RUNNING' | 'COMPLETED' | 'SKIPPED' | 'FAILED' | 'CANCELLED';
  output?: JsonValue;
  error?: string;
};
export type RunOverlayRecord = Omit<RunOverlayInvocation, 'scopeInvocationId'> & {
  invocations: readonly RunOverlayInvocation[];
};

export type EditorStoreOptions = {
  executable: GraphPreset;
  registry: ReadonlyNodeRegistry;
  ids: IdSource;
  apply: (definition: GraphPreset) => void;
  validatedExecutable?: boolean;
};

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function scopeFromNode(node: GraphNode): ScopeGraph | undefined {
  const body = node.data.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const object = body as JsonObject;
  return Array.isArray(object.nodes) && Array.isArray(object.edges) ? (object as ScopeGraph) : undefined;
}

function locateScope(flow: GraphFlow, path: readonly string[]): ScopeGraph | undefined {
  let graph: ScopeGraph = flow;
  for (const nodeId of path) {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    const nested = node && scopeFromNode(node);
    if (!nested) return undefined;
    graph = nested;
  }
  return graph;
}

function findScopePath(
  scope: ScopeGraph,
  nodeId?: string,
  edgeId?: string,
  path: readonly string[] = [],
): readonly string[] | undefined {
  if (
    (nodeId && scope.nodes.some((node) => node.id === nodeId)) ||
    (edgeId && scope.edges.some((edge) => edge.id === edgeId))
  )
    return path;
  for (const node of scope.nodes) {
    const nested = scopeFromNode(node);
    if (!nested) continue;
    const found = findScopePath(nested, nodeId, edgeId, [...path, node.id]);
    if (found) return found;
  }
  return undefined;
}

function allNodeIds(agent: GraphPreset['agent']): Set<string> {
  const ids = new Set<string>();
  const visit = (scope: ScopeGraph): void => {
    for (const node of scope.nodes) {
      ids.add(node.id);
      const nested = scopeFromNode(node);
      if (nested) visit(nested);
    }
  };
  for (const flow of agent.flows) visit(flow);
  return ids;
}

function getAtPath(root: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue = root;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = current[segment];
    if (current === undefined) return undefined;
  }
  return current;
}

function deleteAtPath(root: JsonObject, path: string): void {
  const segments = path.split('.');
  let current: JsonValue = root;
  for (const segment of segments.slice(0, -1)) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return;
    current = current[segment];
  }
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) delete current[segments.at(-1)!];
}

function setAtPath(root: JsonObject, path: string, value: JsonValue): void {
  const segments = path.split('.');
  let current: JsonObject | JsonValue[] = root;
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index]!;
    const key: string | number = Array.isArray(current) ? Number(segment) : segment;
    let next = current[key as never] as JsonValue | undefined;
    if (next === null || typeof next !== 'object') {
      next = /^\d+$/.test(segments[index + 1]!) ? [] : {};
      current[key as never] = next as never;
    }
    current = next as JsonObject | JsonValue[];
  }
  const last: string | number = Array.isArray(current) ? Number(segments.at(-1)!) : segments.at(-1)!;
  current[last as never] = value as never;
}

function normalizeDiscriminator(data: JsonObject, path: string, value: JsonValue): void {
  if (path === 'assembly.type') {
    data.assembly =
      value === 'STANDALONE'
        ? { type: 'STANDALONE', role: 'SYSTEM' }
        : {
            type: 'NORMAL_CHAT',
            history: 'NONE',
            placement: { type: 'AFTER_CONTEXT', role: 'SYSTEM' },
          };
    return;
  }
  if (path === 'assembly.placement.type') {
    const assembly = data.assembly as JsonObject;
    assembly.placement =
      value === 'IN_CHAT' ? { type: 'IN_CHAT', role: 'SYSTEM', depth: 0 } : { type: 'AFTER_CONTEXT', role: 'SYSTEM' };
    return;
  }
  if (path === 'lifetime.type') {
    data.lifetime = value === 'FOR_N_GENERATIONS' ? { type: value, generations: 1 } : { type: value };
    return;
  }
  if (path === 'activation.type') {
    data.activation = { type: value };
    return;
  }
  if (path === 'schedule.type') {
    data.schedule = value === 'EVERY_N_EVENTS' ? { type: value, interval: 1 } : { type: value };
    return;
  }
  setAtPath(data, path, value);
}

export class GraphEditorStore {
  readonly executable: ShallowRef<GraphPreset>;
  readonly draft: ShallowRef<GraphPreset>;
  readonly diagnostics: ShallowRef<readonly GraphDiagnostic[]> = shallowRef([]);
  readonly selectedFlowId: ShallowRef<string>;
  readonly selectedNodeIds = shallowRef<readonly string[]>([]);
  readonly selectedEdgeId = shallowRef<string>();
  readonly scopePath = shallowRef<readonly string[]>([]);
  readonly viewportByScope = shallowRef<Record<string, EditorViewport>>({});
  readonly paletteOpen = shallowRef(true);
  readonly runOverlay = shallowRef<Readonly<Record<string, RunOverlayRecord>>>({});
  readonly clipboard = shallowRef<GraphClipboard>();
  readonly signatureSchemaBuffers = shallowRef<Record<string, string>>({});
  readonly signatureSchemaErrors = shallowRef<ReadonlySet<string>>(new Set());
  readonly inspectorJsonBuffers = shallowRef<Record<string, string>>({});
  readonly inspectorJsonErrors = shallowRef<Readonly<Record<string, string>>>({});
  readonly focusRequest = shallowRef<{ scopeKey: string; nodeId?: string; edgeId?: string; sequence: number }>();
  readonly canApply: ComputedRef<boolean>;
  readonly isDirty: ComputedRef<boolean>;
  readonly #registry: ReadonlyNodeRegistry;
  readonly #ids: IdSource;
  readonly #apply: (definition: GraphPreset) => void;
  readonly #history = new CommandHistory<GraphPreset>();
  readonly #signatureSchemaStash = new Map<string, { text: string; invalid: boolean }>();

  constructor(options: EditorStoreOptions) {
    this.#registry = options.registry;
    this.#ids = options.ids;
    this.#apply = options.apply;
    this.executable = shallowRef(clone(options.executable));
    this.draft = shallowRef(clone(options.executable));
    this.selectedFlowId = shallowRef(options.executable.agent.flows[0]?.id ?? '');
    this.canApply = computed(
      () =>
        this.diagnostics.value.length === 0 &&
        this.signatureSchemaErrors.value.size === 0 &&
        Object.keys(this.inspectorJsonErrors.value).length === 0,
    );
    this.isDirty = computed(
      () =>
        JSON.stringify(this.draft.value) !== JSON.stringify(this.executable.value) ||
        Object.keys(this.inspectorJsonErrors.value).length > 0,
    );
    if (!options.validatedExecutable) this.revalidate();
  }

  get canUndo(): boolean {
    return this.#history.canUndo;
  }
  get canRedo(): boolean {
    return this.#history.canRedo;
  }
  get selectedFlow(): GraphFlow | undefined {
    return this.draft.value.agent.flows.find((flow) => flow.id === this.selectedFlowId.value);
  }
  get currentGraph(): ScopeGraph | undefined {
    const flow = this.selectedFlow;
    return flow ? locateScope(flow, this.scopePath.value) : undefined;
  }
  get currentScopeKey(): string {
    return [this.selectedFlowId.value, ...this.scopePath.value].join('/');
  }
  get viewport(): EditorViewport {
    return this.viewportByScope.value[this.currentScopeKey] ?? { x: 0, y: 0, zoom: 1 };
  }

  private uniqueIdSource(extraIds: readonly string[] = []): IdSource {
    const used = allNodeIds(this.draft.value.agent);
    for (const id of extraIds) used.add(id);
    return {
      generate: () => {
        let id = this.#ids.generate();
        while (used.has(id)) id = this.#ids.generate();
        used.add(id);
        return id;
      },
    };
  }

  private generateEdgeId(graph: ScopeGraph): string {
    const used = new Set(graph.edges.map((edge) => edge.id));
    let id = this.#ids.generate();
    while (used.has(id)) id = this.#ids.generate();
    return id;
  }

  private commit(label: string, mutate: (draft: GraphPreset) => void): void {
    const before = clone(this.draft.value);
    const after = clone(before);
    mutate(after);
    this.#history.record({ label, before, after: clone(after) });
    this.draft.value = after;
    this.reconcileSignatureSchemaDrafts(before, after, false);
    this.revalidate();
  }

  private mutateCurrentGraph(draft: GraphPreset, mutate: (graph: ScopeGraph) => void): void {
    const flow = draft.agent.flows.find((candidate) => candidate.id === this.selectedFlowId.value);
    const graph = flow && locateScope(flow, this.scopePath.value);
    if (!graph) return;
    mutate(graph);
  }

  private applyGeometryPatches(patches: readonly GeometryPatch[], side: 'before' | 'after'): void {
    const targets = patches.map((patch) => {
      const flow = this.draft.value.agent.flows.find((candidate) => candidate.id === patch.flowId);
      if (!flow) {
        throw new Error(`Geometry patch invariant violated: flow "${patch.flowId}" is missing`);
      }
      const graph = locateScope(flow, patch.scopePath);
      if (!graph) {
        throw new Error(
          `Geometry patch invariant violated: scope ${JSON.stringify(patch.scopePath)} in flow "${patch.flowId}" is missing`,
        );
      }
      const node = graph.nodes.find((candidate) => candidate.id === patch.nodeId);
      if (!node) {
        throw new Error(
          `Geometry patch invariant violated: node "${patch.nodeId}" in flow "${patch.flowId}" scope ${JSON.stringify(patch.scopePath)} is missing`,
        );
      }
      return { patch, node };
    });

    for (const { patch, node } of targets) {
      if (patch.kind === 'position') node.position = { ...patch[side] };
      else {
        const size = patch[side];
        if (size) node.size = { ...size };
        else delete node.size;
      }
    }
    triggerRef(this.draft);
  }

  private commitGeometry(label: string, patches: readonly GeometryPatch[]): void {
    if (patches.length === 0) return;
    this.#history.record({
      label,
      undo: () => this.applyGeometryPatches(patches, 'before'),
      redo: () => this.applyGeometryPatches(patches, 'after'),
    });
    this.applyGeometryPatches(patches, 'after');
  }

  revalidate(): void {
    const result = compileGraphPreset(this.draft.value, this.#registry);
    this.diagnostics.value = result.success ? [] : result.diagnostics;
  }

  synchronizeMetadata(metadata: Pick<GraphPreset['agent'], 'name' | 'priority' | 'enabled'>): void {
    const synchronize = (preset: GraphPreset): GraphPreset => ({
      ...preset,
      agent: {
        ...preset.agent,
        name: metadata.name,
        priority: metadata.priority,
        enabled: metadata.enabled,
      },
    });
    this.executable.value = synchronize(this.executable.value);
    this.draft.value = synchronize(this.draft.value);
  }

  inspectorJsonKey(nodeId: string, kind: 'field' | 'input', path: string): string {
    return JSON.stringify([this.selectedFlowId.value, ...this.scopePath.value, nodeId, kind, path]);
  }

  inspectorJsonText(key: string, value: JsonValue | undefined): string {
    return this.inspectorJsonBuffers.value[key] ?? JSON.stringify(value ?? null, null, 2);
  }

  updateInspectorJsonDraft(key: string, text: string, error?: string): void {
    this.inspectorJsonBuffers.value = { ...this.inspectorJsonBuffers.value, [key]: text };
    const errors = { ...this.inspectorJsonErrors.value };
    if (error) errors[key] = error;
    else delete errors[key];
    this.inspectorJsonErrors.value = errors;
  }

  clearInspectorJsonDraft(key: string): void {
    if (Object.hasOwn(this.inspectorJsonBuffers.value, key)) {
      const buffers = { ...this.inspectorJsonBuffers.value };
      delete buffers[key];
      this.inspectorJsonBuffers.value = buffers;
    }
    if (Object.hasOwn(this.inspectorJsonErrors.value, key)) {
      const errors = { ...this.inspectorJsonErrors.value };
      delete errors[key];
      this.inspectorJsonErrors.value = errors;
    }
  }

  apply(): boolean {
    if (!this.canApply.value) return false;
    const applied = clone(this.draft.value);
    this.#apply(applied);
    this.executable.value = clone(applied);
    this.#history.clear();
    this.signatureSchemaBuffers.value = {};
    this.signatureSchemaErrors.value = new Set();
    this.#signatureSchemaStash.clear();
    this.inspectorJsonBuffers.value = {};
    this.inspectorJsonErrors.value = {};
    return true;
  }

  reset(): void {
    this.draft.value = clone(this.executable.value);
    this.#history.clear();
    this.signatureSchemaBuffers.value = {};
    this.signatureSchemaErrors.value = new Set();
    this.#signatureSchemaStash.clear();
    this.inspectorJsonBuffers.value = {};
    this.inspectorJsonErrors.value = {};
    this.scopePath.value = [];
    this.selectedNodeIds.value = [];
    this.selectedEdgeId.value = undefined;
    this.revalidate();
  }

  private restoreHistoryValue(value: GraphPreset): void {
    const previous = this.draft.value;
    const restored = clone(value);
    restored.agent.name = previous.agent.name;
    restored.agent.priority = previous.agent.priority;
    restored.agent.enabled = previous.agent.enabled;
    this.draft.value = restored;
    this.reconcileSignatureSchemaDrafts(previous, restored);
    this.revalidate();
  }

  undo(): void {
    const value = this.#history.undo();
    if (value) this.restoreHistoryValue(value);
  }

  redo(): void {
    const value = this.#history.redo();
    if (value) this.restoreHistoryValue(value);
  }

  selectFlow(flowId: string): void {
    if (!this.draft.value.agent.flows.some((flow) => flow.id === flowId)) return;
    this.selectedFlowId.value = flowId;
    this.scopePath.value = [];
    this.selectedNodeIds.value = [];
    this.selectedEdgeId.value = undefined;
  }

  openBody(nodeId: string): void {
    const node = this.currentGraph?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !scopeFromNode(node)) return;
    this.scopePath.value = [...this.scopePath.value, nodeId];
    this.selectedNodeIds.value = [];
    this.selectedEdgeId.value = undefined;
  }

  closeBody(): void {
    this.scopePath.value = this.scopePath.value.slice(0, -1);
    this.selectedNodeIds.value = [];
    this.selectedEdgeId.value = undefined;
  }

  setViewport(viewport: EditorViewport): void {
    this.viewportByScope.value = { ...this.viewportByScope.value, [this.currentScopeKey]: { ...viewport } };
  }

  addNode(type: string, position = { x: 80, y: 80 }): string | undefined {
    const definition = this.#registry.get(type);
    if (!definition || !this.currentGraph) return undefined;
    const safeIds = this.uniqueIdSource();
    const id = safeIds.generate();
    const data = definition.initialData({ ids: safeIds });
    const node: GraphNode = {
      id,
      type,
      position,
      data,
      inputValues: definition.initialInputValues({ ids: safeIds }, data),
    };
    this.commit(`Add ${type}`, (draft) => this.mutateCurrentGraph(draft, (graph) => graph.nodes.push(node)));
    this.selectedNodeIds.value = [id];
    return id;
  }

  moveNodes(positions: Readonly<Record<string, { x: number; y: number }>>): void {
    const flowId = this.selectedFlowId.value;
    const scopePath = [...this.scopePath.value];
    const patches: GeometryPatch[] = [];
    for (const node of this.currentGraph?.nodes ?? []) {
      const position = positions[node.id];
      if (!position || (position.x === node.position.x && position.y === node.position.y)) continue;
      patches.push({
        kind: 'position',
        flowId,
        scopePath,
        nodeId: node.id,
        before: { ...node.position },
        after: { ...position },
      });
    }
    this.commitGeometry('Move nodes', patches);
  }

  layoutScopes(layouts: readonly ScopeLayoutPositions[]): void {
    const patches: GeometryPatch[] = [];
    for (const layout of layouts) {
      const flow = this.draft.value.agent.flows.find((candidate) => candidate.id === layout.flowId);
      const graph = flow && locateScope(flow, layout.scopePath);
      if (!graph) continue;
      for (const node of graph.nodes) {
        const position = layout.positions[node.id];
        if (!position || (position.x === node.position.x && position.y === node.position.y)) continue;
        patches.push({
          kind: 'position',
          flowId: layout.flowId,
          scopePath: [...layout.scopePath],
          nodeId: node.id,
          before: { ...node.position },
          after: { ...position },
        });
      }
    }
    this.commitGeometry('Smart layout all flows', patches);
  }

  resizeNode(nodeId: string, size: { width: number; height: number }): void {
    const normalized = {
      width: Number.isFinite(size.width) ? Math.max(GRAPH_NODE_MIN_WIDTH, size.width) : GRAPH_NODE_MIN_WIDTH,
      height: Number.isFinite(size.height) ? Math.max(GRAPH_NODE_MIN_HEIGHT, size.height) : GRAPH_NODE_MIN_HEIGHT,
    };
    const currentNode = this.currentGraph?.nodes.find((node) => node.id === nodeId);
    if (!currentNode) return;
    const current = currentNode.size;
    if (current?.width === normalized.width && current.height === normalized.height) return;
    this.commitGeometry('Resize node', [
      {
        kind: 'size',
        flowId: this.selectedFlowId.value,
        scopePath: [...this.scopePath.value],
        nodeId,
        before: current ? { ...current } : undefined,
        after: normalized,
      },
    ]);
  }

  updateNodeData(nodeId: string, path: string, value: JsonValue): void {
    const currentScope = this.selectedFlow
      ? resolveEditorScope(this.draft.value.agent, this.selectedFlow, this.scopePath.value, this.#registry)
      : undefined;
    const oldInputs = new Set(
      currentScope?.resolved.get(nodeId)?.inputs.flatMap((port) => (port.kind === 'DATA' ? [port.id] : [])) ?? [],
    );
    this.commit(`Edit ${path}`, (draft) => {
      this.mutateCurrentGraph(draft, (graph) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (node) normalizeDiscriminator(node.data, path, clone(value));
      });
      const flow = draft.agent.flows.find((candidate) => candidate.id === this.selectedFlowId.value);
      const scope = flow && resolveEditorScope(draft.agent, flow, this.scopePath.value, this.#registry);
      const node = scope?.graph.nodes.find((candidate) => candidate.id === nodeId);
      const newInputs = new Set(
        scope?.resolved.get(nodeId)?.inputs.flatMap((port) => (port.kind === 'DATA' ? [port.id] : [])) ?? [],
      );
      if (node) for (const portId of oldInputs) if (!newInputs.has(portId)) delete node.inputValues[portId];
    });
  }

  removeNodeData(nodeId: string, path: string): void {
    this.commit(`Remove ${path}`, (draft) =>
      this.mutateCurrentGraph(draft, (graph) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (node) deleteAtPath(node.data, path);
      }),
    );
  }

  updateInputValue(nodeId: string, portId: string, value: JsonValue | undefined): void {
    this.commit(`Edit ${portId}`, (draft) =>
      this.mutateCurrentGraph(draft, (graph) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) return;
        if (value === undefined) delete node.inputValues[portId];
        else node.inputValues[portId] = clone(value);
      }),
    );
  }

  addRepeaterItem(nodeId: string, path: string): void {
    this.commit(`Add ${path} item`, (draft) =>
      this.mutateCurrentGraph(draft, (graph) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) return;
        const current = getAtPath(node.data, path);
        if (!Array.isArray(current)) return;
        const index = current.length + 1;
        const id = this.#ids.generate();
        let item: JsonObject = { id, label: `Value ${index}` };
        if (node.type === 'data.object') item = { id, key: `field${index}`, schema: {} };
        else if (node.type === 'data.array') item = { id, label: `Item ${index}` };
        else if (node.type === 'data.template' || node.type === 'llm.request') item = { id, name: `value${index}` };
        else if (node.type === 'control.branch') item = { id, label: `Case ${index}` };
        else if (node.type === 'control.merge-any' || node.type === 'control.merge-all')
          item = { id, label: `Input ${index}`, carriesValue: false };
        current.push(item);
      }),
    );
  }

  removeRepeaterItem(nodeId: string, path: string, index: number, minimum: number): void {
    this.commit(`Remove ${path} item`, (draft) =>
      this.mutateCurrentGraph(draft, (graph) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        const current = node && getAtPath(node.data, path);
        if (Array.isArray(current) && current.length > minimum) current.splice(index, 1);
      }),
    );
  }

  moveRepeaterItem(nodeId: string, path: string, index: number, direction: -1 | 1): void {
    this.commit(`Move ${path} item`, (draft) =>
      this.mutateCurrentGraph(draft, (graph) => {
        const node = graph.nodes.find((candidate) => candidate.id === nodeId);
        const current = node && getAtPath(node.data, path);
        const target = index + direction;
        if (!Array.isArray(current) || target < 0 || target >= current.length) return;
        const [item] = current.splice(index, 1);
        current.splice(target, 0, item!);
      }),
    );
  }

  connect(edge: Omit<GraphEdge, 'id'>): string | undefined {
    const graph = this.currentGraph;
    if (!graph) return undefined;
    const id = this.generateEdgeId(graph);
    this.commit('Connect ports', (draft) =>
      this.mutateCurrentGraph(draft, (scope) => {
        scope.edges.push({ ...clone(edge), id });
        if (edge.kind === 'DATA') {
          const target = scope.nodes.find((node) => node.id === edge.target.nodeId);
          if (target) delete target.inputValues[edge.target.portId];
        }
      }),
    );
    return id;
  }

  removeEdges(edgeIds: readonly string[]): void {
    const removed = new Set(edgeIds);
    this.commit('Remove edges', (draft) =>
      this.mutateCurrentGraph(draft, (graph) => {
        graph.edges = graph.edges.filter((edge) => !removed.has(edge.id));
      }),
    );
    this.selectedEdgeId.value = undefined;
  }

  deleteSelection(): void {
    const nodes = new Set(this.selectedNodeIds.value);
    const edgeId = this.selectedEdgeId.value;
    this.commit('Delete selection', (draft) =>
      this.mutateCurrentGraph(draft, (graph) => {
        graph.nodes = graph.nodes.filter((node) => !nodes.has(node.id));
        graph.edges = graph.edges.filter(
          (edge) => edge.id !== edgeId && !nodes.has(edge.source.nodeId) && !nodes.has(edge.target.nodeId),
        );
      }),
    );
    this.selectedNodeIds.value = [];
    this.selectedEdgeId.value = undefined;
  }

  copy(): void {
    const graph = this.currentGraph;
    if (graph) this.clipboard.value = copySelection(graph, new Set(this.selectedNodeIds.value));
  }

  paste(): void {
    const graph = this.currentGraph;
    const clipboard = this.clipboard.value;
    if (!graph || !clipboard || clipboard.nodes.length === 0) return;
    const reserved = allNodeIds(this.draft.value.agent);
    for (const edge of graph.edges) reserved.add(edge.id);
    const pasted = pasteClipboard(clipboard, reserved, this.#ids);
    this.commit('Paste nodes', (draft) =>
      this.mutateCurrentGraph(draft, (scope) => {
        scope.nodes.push(...pasted.nodes);
        scope.edges.push(...pasted.edges);
      }),
    );
    this.selectedNodeIds.value = pasted.nodes.map((node) => node.id);
  }

  createFlow(kind: GraphFlow['kind']): string {
    const flowIds = new Set(this.draft.value.agent.flows.map((flow) => flow.id));
    let id = this.#ids.generate();
    while (flowIds.has(id)) id = this.#ids.generate();
    const flow: GraphFlow = {
      id,
      name: kind === 'TRIGGER' ? 'New trigger flow' : 'New subflow',
      kind,
      inputs: [],
      outputs: [],
      nodes: [],
      edges: [],
    };
    if (kind === 'SUBFLOW') {
      const safeIds = this.uniqueIdSource();
      const entry = safeIds.generate();
      const returned = safeIds.generate();
      flow.nodes = [
        { id: entry, type: 'scope.entry', position: { x: 0, y: 0 }, data: {}, inputValues: {} },
        { id: returned, type: 'scope.return', position: { x: 240, y: 0 }, data: {}, inputValues: {} },
      ];
      flow.edges = [
        {
          id: safeIds.generate(),
          kind: 'CONTROL',
          source: { nodeId: entry, portId: 'out' },
          target: { nodeId: returned, portId: 'in' },
        },
      ];
    }
    this.commit('Create flow', (draft) => draft.agent.flows.push(flow));
    this.selectFlow(id);
    return id;
  }

  duplicateFlow(flowId = this.selectedFlowId.value): string | undefined {
    const source = this.draft.value.agent.flows.find((flow) => flow.id === flowId);
    if (!source) return undefined;
    const flowIds = new Set(this.draft.value.agent.flows.map((flow) => flow.id));
    let id = this.#ids.generate();
    while (flowIds.has(id)) id = this.#ids.generate();
    const pasted = pasteClipboard(
      copySelection(source, new Set(source.nodes.map((node) => node.id))),
      allNodeIds(this.draft.value.agent),
      this.#ids,
      { x: 0, y: 0 },
    );
    const flow: GraphFlow = {
      ...clone(source),
      id,
      name: `${source.name} copy`,
      nodes: pasted.nodes,
      edges: pasted.edges,
    };
    this.commit('Duplicate flow', (draft) => draft.agent.flows.push(flow));
    this.selectFlow(id);
    return id;
  }

  private reconcileSignatureSchemaDrafts(previous: GraphPreset, restored: GraphPreset, restoreStashed = true): void {
    const buffers: Record<string, string> = {};
    const errors = new Set<string>();
    const consumed = new Set<string>();
    for (const previousFlow of previous.agent.flows) {
      const restoredFlow = restored.agent.flows.find((flow) => flow.id === previousFlow.id);
      for (const direction of ['inputs', 'outputs'] as const) {
        const previousPorts = previousFlow[direction];
        const restoredPorts = restoredFlow?.[direction] ?? [];
        for (const [index, previousPort] of previousPorts.entries()) {
          const previousKey = `${previousFlow.id}:${direction}:${previousPort.id}`;
          const text = this.signatureSchemaBuffers.value[previousKey];
          if (text === undefined) continue;
          consumed.add(previousKey);
          const restoredPort =
            restoredPorts.find((port) => port.id === previousPort.id) ??
            (previousPorts.length === restoredPorts.length ? restoredPorts[index] : undefined);
          if (!restoredPort) {
            this.#signatureSchemaStash.set(previousKey, {
              text,
              invalid: this.signatureSchemaErrors.value.has(previousKey),
            });
            continue;
          }
          const restoredKey = `${previousFlow.id}:${direction}:${restoredPort.id}`;
          const invalid = this.signatureSchemaErrors.value.has(previousKey);
          buffers[restoredKey] =
            !invalid && JSON.stringify(previousPort.schema) !== JSON.stringify(restoredPort.schema)
              ? JSON.stringify(restoredPort.schema, null, 2)
              : text;
          if (invalid) errors.add(restoredKey);
        }
      }
    }
    for (const [key, text] of Object.entries(this.signatureSchemaBuffers.value)) {
      if (!consumed.has(key))
        this.#signatureSchemaStash.set(key, { text, invalid: this.signatureSchemaErrors.value.has(key) });
    }
    if (restoreStashed)
      for (const restoredFlow of restored.agent.flows) {
        for (const direction of ['inputs', 'outputs'] as const) {
          for (const port of restoredFlow[direction]) {
            const key = `${restoredFlow.id}:${direction}:${port.id}`;
            const stashed = this.#signatureSchemaStash.get(key);
            if (buffers[key] === undefined && stashed) {
              buffers[key] = stashed.text;
              if (stashed.invalid) errors.add(key);
              this.#signatureSchemaStash.delete(key);
            }
          }
        }
      }
    this.signatureSchemaBuffers.value = buffers;
    this.signatureSchemaErrors.value = errors;
  }

  addFlowPort(direction: 'inputs' | 'outputs'): string | undefined {
    const flow = this.selectedFlow;
    if (!flow || flow.kind !== 'SUBFLOW') return undefined;
    const used = new Set([...flow.inputs, ...flow.outputs].map((port) => port.id));
    let id = this.#ids.generate();
    while (used.has(id)) id = this.#ids.generate();
    const port: FlowPortDeclaration = {
      id,
      label: direction === 'inputs' ? 'Input' : 'Output',
      required: true,
      cardinality: 'ONE',
      schema: {},
    };
    this.commit(`Add flow ${direction.slice(0, -1)}`, (draft) => {
      const target = draft.agent.flows.find((candidate) => candidate.id === flow.id);
      if (target) target[direction].push(port);
    });
    return id;
  }

  removeFlowPort(direction: 'inputs' | 'outputs', portId: string): void {
    const key = `${this.selectedFlowId.value}:${direction}:${portId}`;
    const buffered = this.signatureSchemaBuffers.value[key];
    if (buffered !== undefined)
      this.#signatureSchemaStash.set(key, { text: buffered, invalid: this.signatureSchemaErrors.value.has(key) });
    this.commit(`Remove flow ${direction.slice(0, -1)}`, (draft) => {
      const flow = draft.agent.flows.find((candidate) => candidate.id === this.selectedFlowId.value);
      if (flow) flow[direction] = flow[direction].filter((port) => port.id !== portId);
    });
    if (Object.hasOwn(this.signatureSchemaBuffers.value, key)) {
      const buffers = { ...this.signatureSchemaBuffers.value };
      delete buffers[key];
      this.signatureSchemaBuffers.value = buffers;
    }
    if (this.signatureSchemaErrors.value.has(key)) {
      const errors = new Set(this.signatureSchemaErrors.value);
      errors.delete(key);
      this.signatureSchemaErrors.value = errors;
    }
  }

  moveFlowPort(direction: 'inputs' | 'outputs', portId: string, offset: -1 | 1): void {
    this.commit(`Move flow ${direction.slice(0, -1)}`, (draft) => {
      const ports = draft.agent.flows.find((flow) => flow.id === this.selectedFlowId.value)?.[direction];
      const index = ports?.findIndex((port) => port.id === portId) ?? -1;
      const target = index + offset;
      if (!ports || index < 0 || target < 0 || target >= ports.length) return;
      const [port] = ports.splice(index, 1);
      ports.splice(target, 0, port!);
    });
  }

  updateFlowPort(
    direction: 'inputs' | 'outputs',
    portId: string,
    field: 'id' | 'label' | 'required' | 'schema',
    value: string | boolean | JsonObject,
  ): void {
    const flowId = this.selectedFlowId.value;
    this.commit(`Edit flow ${direction.slice(0, -1)} ${field}`, (draft) => {
      const port = draft.agent.flows
        .find((flow) => flow.id === flowId)
        ?.[direction].find((candidate) => candidate.id === portId);
      if (port) Object.assign(port, { [field]: clone(value) });
    });
    if (field === 'id' && typeof value === 'string') {
      const oldKey = `${flowId}:${direction}:${portId}`;
      const nextKey = `${flowId}:${direction}:${value}`;
      if (Object.hasOwn(this.signatureSchemaBuffers.value, oldKey)) {
        const next = { ...this.signatureSchemaBuffers.value };
        next[nextKey] = next[oldKey]!;
        delete next[oldKey];
        this.signatureSchemaBuffers.value = next;
      }
      if (this.signatureSchemaErrors.value.has(oldKey)) {
        const errors = new Set(this.signatureSchemaErrors.value);
        errors.delete(oldKey);
        errors.add(nextKey);
        this.signatureSchemaErrors.value = errors;
      }
    }
  }

  flowPortSchemaText(direction: 'inputs' | 'outputs', port: FlowPortDeclaration): string {
    const key = `${this.selectedFlowId.value}:${direction}:${port.id}`;
    return this.signatureSchemaBuffers.value[key] ?? JSON.stringify(port.schema, null, 2);
  }

  updateFlowPortSchemaText(direction: 'inputs' | 'outputs', portId: string, text: string): boolean {
    const key = `${this.selectedFlowId.value}:${direction}:${portId}`;
    this.signatureSchemaBuffers.value = { ...this.signatureSchemaBuffers.value, [key]: text };
    try {
      const schema = JSON.parse(text) as JsonValue;
      if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Expected object');
      const errors = new Set(this.signatureSchemaErrors.value);
      errors.delete(key);
      this.signatureSchemaErrors.value = errors;
      this.updateFlowPort(direction, portId, 'schema', schema);
      return true;
    } catch {
      const errors = new Set(this.signatureSchemaErrors.value);
      errors.add(key);
      this.signatureSchemaErrors.value = errors;
      return false;
    }
  }

  renameFlow(flowId: string, name: string): void {
    this.commit('Rename flow', (draft) => {
      const flow = draft.agent.flows.find((candidate) => candidate.id === flowId);
      if (flow) flow.name = name;
    });
  }

  deleteFlow(flowId = this.selectedFlowId.value): void {
    this.commit('Delete flow', (draft) => {
      draft.agent.flows = draft.agent.flows.filter((flow) => flow.id !== flowId);
    });
    this.selectFlow(this.draft.value.agent.flows[0]?.id ?? '');
  }

  compilerScope(flowId: string): { rootFlowId: string; scopePath: readonly string[] } | undefined {
    const parts = flowId.split('/');
    const root = this.draft.value.agent.flows.find((flow) => flow.id === parts[0]);
    if (!root) return undefined;
    const path = parts.slice(1);
    return locateScope(root, path) ? { rootFlowId: root.id, scopePath: path } : undefined;
  }

  focusDiagnostic(diagnostic: GraphDiagnostic): void {
    const location = diagnostic.location;
    if (location.kind === 'AGENT') return;
    const parsed = this.compilerScope(location.flowId);
    if (!parsed) return;
    this.selectFlow(parsed.rootFlowId);
    const flow = this.selectedFlow;
    this.scopePath.value = [...parsed.scopePath];
    if (location.kind === 'NODE' || location.kind === 'PORT') {
      if (flow && !this.currentGraph?.nodes.some((node) => node.id === location.nodeId))
        this.scopePath.value = findScopePath(flow, location.nodeId) ?? parsed.scopePath;
      this.selectedNodeIds.value = [location.nodeId];
      this.selectedEdgeId.value = undefined;
      this.focusRequest.value = {
        scopeKey: this.currentScopeKey,
        nodeId: location.nodeId,
        sequence: (this.focusRequest.value?.sequence ?? 0) + 1,
      };
    } else if (location.kind === 'EDGE') {
      if (flow && !this.currentGraph?.edges.some((edge) => edge.id === location.edgeId))
        this.scopePath.value = findScopePath(flow, undefined, location.edgeId) ?? parsed.scopePath;
      this.selectedNodeIds.value = [];
      this.selectedEdgeId.value = location.edgeId;
      this.focusRequest.value = {
        scopeKey: this.currentScopeKey,
        edgeId: location.edgeId,
        sequence: (this.focusRequest.value?.sequence ?? 0) + 1,
      };
    } else {
      this.selectedNodeIds.value = [];
      this.selectedEdgeId.value = undefined;
      this.focusRequest.value = {
        scopeKey: this.currentScopeKey,
        sequence: (this.focusRequest.value?.sequence ?? 0) + 1,
      };
    }
  }

  setRunOverlay(records: Readonly<Record<string, RunOverlayRecord>>): void {
    const retained = Object.entries(records)
      .flatMap(([nodeId, record]) => record.invocations.map((invocation) => ({ nodeId, invocation })))
      .slice(-200);
    const grouped: Record<string, RunOverlayInvocation[]> = {};
    for (const { nodeId, invocation } of retained) {
      const outputText = invocation.output === undefined ? '' : JSON.stringify(invocation.output);
      (grouped[nodeId] ??= []).push({
        scopeInvocationId: invocation.scopeInvocationId,
        status: invocation.status,
        ...(invocation.error ? { error: invocation.error.slice(0, 8192) } : {}),
        ...(invocation.output !== undefined && outputText.length <= 8192 ? { output: clone(invocation.output) } : {}),
      });
    }
    this.runOverlay.value = Object.fromEntries(
      Object.entries(grouped).map(([nodeId, invocations]) => {
        const latest = invocations.at(-1)!;
        return [
          nodeId,
          {
            status: latest.status,
            ...(latest.error === undefined ? {} : { error: latest.error }),
            ...(latest.output === undefined ? {} : { output: clone(latest.output) }),
            invocations,
          },
        ];
      }),
    );
  }

  clearRunOverlay(): void {
    this.runOverlay.value = {};
  }
}
