<script setup lang="ts">
import {
  VueFlow,
  useVueFlow,
  type Connection,
  type EdgeChange,
  type NodeDragEvent,
  type NodeMouseEvent,
  type ViewportTransform,
} from '@vue-flow/core';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Button } from '../../../../components/UI';
import { GRAPH_NODE_MIN_HEIGHT, GRAPH_NODE_MIN_WIDTH } from '../graph/contracts';
import type { ReadonlyNodeRegistry } from '../registry/node-definition';
import type { GraphEditorStore } from './editor-store';
import NodeShell from './NodeShell.vue';
import type { ResolvedEditorNode } from './vue-flow-adapter';
import { useEditorI18n } from './editor-i18n';
import { smartLayout } from './smart-layout';
import {
  createVueFlowRenderCache,
  isValidConnection,
  nodePositionsFromVue,
  resolveEditorScope,
  toVueFlow,
  viewportFromVue,
} from './vue-flow-adapter';

const props = defineProps<{
  store: GraphEditorStore;
  registry: ReadonlyNodeRegistry;
  resolvedPorts?: ReadonlyMap<string, ResolvedEditorNode>;
  rootResolved?: ReadonlyMap<string, ResolvedEditorNode>;
}>();
const emit = defineEmits<{
  smartLayoutBusy: [busy: boolean];
  smartLayoutFailed: [reason: 'UNMEASURED' | 'UNAVAILABLE'];
  smartLayoutSucceeded: [];
}>();
const { t } = useEditorI18n();
const scopeKey = props.store.currentScopeKey;
const flowId = scopeKey;
const initialViewport = props.store.viewportFor(scopeKey);
const vueFlow = useVueFlow(scopeKey);
const { fitView, getViewport, project, setViewport, updateNodeInternals, zoomIn, zoomOut } = vueFlow;
const flow = computed(() => props.store.selectedFlow);
const graph = computed(() => props.store.currentGraph);
const resolved = computed<ReadonlyMap<string, ResolvedEditorNode>>(
  () =>
    props.resolvedPorts ??
    (flow.value && graph.value
      ? (resolveEditorScope(props.store.draft.value.agent, flow.value, props.store.scopePath.value, props.registry)
          ?.resolved ?? new Map<string, ResolvedEditorNode>())
      : new Map<string, ResolvedEditorNode>()),
);
const invalidNodes = computed(
  () =>
    new Set(
      props.store.diagnostics.value.flatMap((diagnostic) => {
        const location = diagnostic.location;
        return (location.kind === 'NODE' || location.kind === 'PORT') && location.flowId === props.store.currentScopeKey
          ? [location.nodeId]
          : [];
      }),
    ),
);
const renderCache = createVueFlowRenderCache();
const previewSizes = shallowRef<Record<string, { width: number; height: number }>>({});
const renderAllNodes = ref(false);
const smartLayoutBusy = ref(false);
const canvasRoot = ref<HTMLElement>();
const invalidEdges = computed(
  () =>
    new Set(
      props.store.diagnostics.value.flatMap((diagnostic) => {
        const location = diagnostic.location;
        return location.kind === 'EDGE' && location.flowId === props.store.currentScopeKey ? [location.edgeId] : [];
      }),
    ),
);
const elements = computed(() =>
  graph.value
    ? toVueFlow(
        graph.value,
        resolved.value,
        invalidNodes.value,
        invalidEdges.value,
        props.store.runOverlay.value,
        new Set(props.store.selectedNodeIds.value),
        props.store.selectedEdgeId.value,
        renderCache,
        previewSizes.value,
      )
    : { nodes: [], edges: [] },
);

async function restoreViewport() {
  await nextTick();
  await nextRenderFrame();
  await setViewport(initialViewport);
}

onBeforeUnmount(() => {
  props.store.setViewport(viewportFromVue(getViewport()), scopeKey);
});
watch(
  () => props.store.focusRequest.value?.sequence,
  async () => {
    const request = props.store.focusRequest.value;
    if (!request || request.scopeKey !== props.store.currentScopeKey) return;
    await nextTick();
    let nodeIds = request.nodeId ? [request.nodeId] : [];
    if (request.edgeId) {
      const edge = graph.value?.edges.find((candidate) => candidate.id === request.edgeId);
      if (edge) nodeIds = [edge.source.nodeId, edge.target.nodeId];
    }
    await fitView(nodeIds.length ? { nodes: nodeIds, padding: 0.3 } : { padding: 0.15 });
  },
  { immediate: true },
);

function connectionEdge(connection: Connection) {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle)
    return undefined;
  const source = resolved.value.get(connection.source)?.outputs.find((port) => port.id === connection.sourceHandle);
  if (!source) return undefined;
  return {
    kind: source.kind,
    source: { nodeId: connection.source, portId: connection.sourceHandle },
    target: { nodeId: connection.target, portId: connection.targetHandle },
  } as const;
}
function valid(connection: Connection): boolean {
  const edge = connectionEdge(connection);
  const existingEdgeId = 'id' in connection && typeof connection.id === 'string' ? connection.id : undefined;
  return !!edge && !!graph.value && isValidConnection(edge, graph.value, resolved.value, existingEdgeId);
}
function connect(connection: Connection) {
  const edge = connectionEdge(connection);
  if (edge && valid(connection)) props.store.connect(edge);
}
function nodeClick(event: NodeMouseEvent) {
  props.store.selectedNodeIds.value = [event.node.id];
  props.store.selectedEdgeId.value = undefined;
}
function selectionChanged(selection: { nodes: Array<{ id: string }>; edges: Array<{ id: string }> }) {
  props.store.selectedNodeIds.value = selection.nodes.map((node) => node.id);
  props.store.selectedEdgeId.value = selection.nodes.length === 0 ? selection.edges[0]?.id : undefined;
}
function edgeChanges(changes: EdgeChange[]) {
  const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
  if (removed.length) props.store.removeEdges(removed);
}
function nodeDragStop(event: NodeDragEvent) {
  const dragged = event.nodes?.length ? event.nodes : [event.node];
  props.store.moveNodes(nodePositionsFromVue(dragged));
}
function viewportChanged(viewport: ViewportTransform) {
  props.store.setViewport(viewportFromVue(viewport), scopeKey);
}
function nextRenderFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function layoutPortOrders(activeGraph: NonNullable<typeof graph.value>) {
  return Object.fromEntries(
    activeGraph.nodes.map((node) => {
      const ports = resolved.value.get(node.id);
      const inputs = ports?.inputs.map((port) => port.id) ?? [];
      const outputs = ports?.outputs.map((port) => port.id) ?? [];
      for (const edge of activeGraph.edges) {
        if (edge.target.nodeId === node.id && !inputs.includes(edge.target.portId)) inputs.push(edge.target.portId);
        if (edge.source.nodeId === node.id && !outputs.includes(edge.source.portId)) outputs.push(edge.source.portId);
      }
      return [node.id, { inputs, outputs }] as const;
    }),
  );
}

function measuredNodeDimensions(nodeIds: readonly string[]) {
  const mountedNodes = new Map(
    [...(canvasRoot.value?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])].flatMap((article) => {
      const id = article.dataset.nodeId;
      const mountedNode = article.closest<HTMLElement>('.vue-flow__node');
      return id && mountedNode ? [[id, mountedNode] as const] : [];
    }),
  );
  return Object.fromEntries(
    nodeIds.flatMap((id) => {
      const mountedNode = mountedNodes.get(id);
      return mountedNode && mountedNode.offsetWidth > 0 && mountedNode.offsetHeight > 0
        ? [[id, { width: mountedNode.offsetWidth, height: mountedNode.offsetHeight }] as const]
        : [];
    }),
  );
}

async function applySmartLayout(): Promise<boolean> {
  if (smartLayoutBusy.value) return false;
  const activeGraph = graph.value;
  const activeScopeKey = props.store.currentScopeKey;
  if (!activeGraph) return false;
  smartLayoutBusy.value = true;
  renderAllNodes.value = true;
  emit('smartLayoutBusy', true);
  try {
    const nodeIds = activeGraph.nodes.map((node) => node.id);
    await nextTick();
    await nextRenderFrame();
    updateNodeInternals(nodeIds);
    await nextTick();
    await nextRenderFrame();
    await nextTick();
    if (props.store.currentScopeKey !== activeScopeKey || graph.value !== activeGraph) {
      emit('smartLayoutFailed', 'UNAVAILABLE');
      return false;
    }
    const result = smartLayout(activeGraph, measuredNodeDimensions(nodeIds), layoutPortOrders(activeGraph));
    if (!result.available) {
      emit('smartLayoutFailed', result.reason === 'UNMEASURED' ? 'UNMEASURED' : 'UNAVAILABLE');
      return false;
    }
    const changed = activeGraph.nodes.some((node) => {
      const position = result.positions[node.id];
      return position && (position.x !== node.position.x || position.y !== node.position.y);
    });
    if (changed) props.store.moveNodes(result.positions);
    await nextTick();
    updateNodeInternals(nodeIds);
    await nextTick();
    await fitView({ padding: 0.15 });
    emit('smartLayoutSucceeded');
    return true;
  } catch {
    emit('smartLayoutFailed', 'UNAVAILABLE');
    return false;
  } finally {
    renderAllNodes.value = false;
    smartLayoutBusy.value = false;
    emit('smartLayoutBusy', false);
    await nextTick();
  }
}
function resizeStart({ nodeId, event }: { nodeId: string; event: PointerEvent }) {
  const node = graph.value?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return;
  const article = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]');
  const zoom = getViewport().zoom;
  const rect = article?.getBoundingClientRect();
  const startSize = {
    width: node.size?.width ?? Math.max(GRAPH_NODE_MIN_WIDTH, (rect?.width ?? 0) / zoom),
    height: node.size?.height ?? Math.max(GRAPH_NODE_MIN_HEIGHT, (rect?.height ?? 0) / zoom),
  };
  const start = project({ x: event.clientX, y: event.clientY });
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture?.(event.pointerId);

  const move = (moveEvent: PointerEvent) => {
    const current = project({ x: moveEvent.clientX, y: moveEvent.clientY });
    previewSizes.value = {
      ...previewSizes.value,
      [nodeId]: {
        width: Math.max(GRAPH_NODE_MIN_WIDTH, startSize.width + current.x - start.x),
        height: Math.max(GRAPH_NODE_MIN_HEIGHT, startSize.height + current.y - start.y),
      },
    };
    void nextTick(() => updateNodeInternals([nodeId]));
  };
  const finish = (commit: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', pointerUp);
    window.removeEventListener('pointercancel', pointerCancel);
    const size = previewSizes.value[nodeId];
    const next = { ...previewSizes.value };
    delete next[nodeId];
    previewSizes.value = next;
    if (commit && size) props.store.resizeNode(nodeId, size);
    void nextTick(() => updateNodeInternals([nodeId]));
  };
  const pointerUp = () => finish(true);
  const pointerCancel = () => finish(false);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', pointerUp, { once: true });
  window.addEventListener('pointercancel', pointerCancel, { once: true });
}
function keydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if (
    target.closest(
      'input, textarea, select, button, a, [contenteditable], [role="button"], [role="combobox"], [role="listbox"], [role="option"], [role="checkbox"], [role="switch"], [role="slider"]',
    )
  )
    return;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) props.store.redo();
    else props.store.undo();
  } else if (modifier && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    props.store.redo();
  } else if (modifier && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    props.store.copy();
  } else if (modifier && event.key.toLowerCase() === 'v') {
    event.preventDefault();
    props.store.paste();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    props.store.deleteSelection();
  }
}
defineExpose({ fitView: () => fitView({ padding: 0.15 }), applySmartLayout });
</script>

<template>
  <div
    ref="canvasRoot"
    class="custom-agent-flow__canvas"
    tabindex="0"
    :data-render-all-nodes="renderAllNodes || undefined"
    @keydown="keydown"
  >
    <VueFlow
      :id="flowId"
      :nodes="elements.nodes"
      :edges="elements.edges"
      :default-viewport="initialViewport"
      :is-valid-connection="valid"
      :delete-key-code="null"
      :only-render-visible-elements="!renderAllNodes"
      :min-zoom="0.1"
      :max-zoom="2.5"
      fit-view-on-init
      @connect="connect"
      @node-click="nodeClick"
      @edge-click="
        store.selectedEdgeId.value = $event.edge.id;
        store.selectedNodeIds.value = [];
      "
      @selection-change="selectionChanged"
      @pane-click="
        store.selectedNodeIds.value = [];
        store.selectedEdgeId.value = undefined;
      "
      @edges-change="edgeChanges"
      @node-drag-stop="nodeDragStop"
      @init="restoreViewport"
      @viewport-change-end="viewportChanged"
    >
      <template #node-graph="slotProps">
        <NodeShell
          v-bind="slotProps"
          :registry="registry"
          :store="store"
          :flow="flow!"
          :graph="graph!"
          :all-resolved="resolved"
          :root-resolved="rootResolved ?? resolved"
          @open-body="store.openBody($event)"
          @resize-start="resizeStart"
        />
      </template>
      <div class="custom-agent-flow__canvas-controls">
        <Button type="button" :title="t('extensionsBuiltin.customAgents.editor.zoomIn')" @click="zoomIn()">+</Button>
        <Button type="button" :title="t('extensionsBuiltin.customAgents.editor.zoomOut')" @click="zoomOut()">−</Button>
        <Button
          type="button"
          :title="t('extensionsBuiltin.customAgents.editor.fitView')"
          @click="fitView({ padding: 0.15 })"
        >
          {{ t('extensionsBuiltin.customAgents.editor.fit') }}
        </Button>
      </div>
    </VueFlow>
  </div>
</template>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
</style>
