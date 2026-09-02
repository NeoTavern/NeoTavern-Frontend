<script setup lang="ts">
import { nextTick, shallowRef } from 'vue';
import { GRAPH_NODE_MIN_WIDTH, type GraphFlow, type JsonObject, type ScopeGraph } from '../graph/contracts';
import type { ReadonlyNodeRegistry } from '../registry/node-definition';
import { GraphEditorStore, type ScopeLayoutPositions } from './editor-store';
import NodeCard from './NodeCard.vue';
import { smartLayout, smartLayoutAvailability } from './smart-layout';
import { resolveEditorScope, toVueFlow, type EditorNodeData, type ResolvedEditorNode } from './vue-flow-adapter';

const props = defineProps<{ store: GraphEditorStore; registry: ReadonlyNodeRegistry }>();
const emit = defineEmits<{
  busy: [busy: boolean];
  failed: [reason: 'CYCLIC' | 'UNMEASURED' | 'UNAVAILABLE'];
  progress: [completed: number, total: number];
  succeeded: [];
}>();
type ScopeTask = { flowId: string; path: readonly string[] };
type Measurement = {
  store: GraphEditorStore;
  flow: GraphFlow;
  graph: ScopeGraph;
  nodes: readonly EditorNodeData[];
  resolved: ReadonlyMap<string, ResolvedEditorNode>;
  rootResolved: ReadonlyMap<string, ResolvedEditorNode>;
};
const measurement = shallowRef<Measurement>();
const measurementRoot = shallowRef<HTMLElement>();
let running = false;

function scopeFromNode(node: ScopeGraph['nodes'][number]): ScopeGraph | undefined {
  const body = node.data.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const object = body as JsonObject;
  return Array.isArray(object.nodes) && Array.isArray(object.edges) ? (object as ScopeGraph) : undefined;
}

function collectTasks(flow: GraphFlow, graph: ScopeGraph, path: readonly string[], tasks: ScopeTask[]): void {
  tasks.push({ flowId: flow.id, path });
  for (const node of graph.nodes) {
    const body = scopeFromNode(node);
    if (body) collectTasks(flow, body, [...path, node.id], tasks);
  }
}

function nextRenderFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function layoutPortOrders(graph: ScopeGraph, resolved: ReadonlyMap<string, ResolvedEditorNode>) {
  return Object.fromEntries(
    graph.nodes.map((node) => {
      const ports = resolved.get(node.id);
      const inputs = ports?.inputs.map((port) => port.id) ?? [];
      const outputs = ports?.outputs.map((port) => port.id) ?? [];
      for (const edge of graph.edges) {
        if (edge.target.nodeId === node.id && !inputs.includes(edge.target.portId)) inputs.push(edge.target.portId);
        if (edge.source.nodeId === node.id && !outputs.includes(edge.source.portId)) outputs.push(edge.source.portId);
      }
      return [node.id, { inputs, outputs }] as const;
    }),
  );
}

function measuredNodeDimensions(nodeIds: readonly string[]) {
  const elements = new Map(
    [...(measurementRoot.value?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])].flatMap((article) => {
      const id = article.dataset.nodeId;
      const wrapper = article.closest<HTMLElement>('[data-layout-node]');
      return id && wrapper ? [[id, wrapper] as const] : [];
    }),
  );
  return Object.fromEntries(
    nodeIds.flatMap((id) => {
      const element = elements.get(id);
      return element && element.offsetWidth > 0 && element.offsetHeight > 0
        ? [[id, { width: element.offsetWidth, height: element.offsetHeight }] as const]
        : [];
    }),
  );
}

async function applySmartLayoutAll(): Promise<boolean> {
  if (running) return false;
  running = true;
  emit('busy', true);
  try {
    const source = structuredClone(props.store.draft.value);
    let generatedId = 0;
    const measurementStore = new GraphEditorStore({
      executable: source,
      registry: props.registry,
      ids: { generate: () => `layout-measure-${++generatedId}` },
      apply: () => undefined,
    });
    const tasks: ScopeTask[] = [];
    for (const flow of source.agent.flows) collectTasks(flow, flow, [], tasks);
    if (
      tasks.some((task) => {
        measurementStore.selectFlow(task.flowId);
        measurementStore.scopePath.value = task.path;
        const graph = measurementStore.currentGraph;
        return !graph || !smartLayoutAvailability(graph).available;
      })
    ) {
      emit('failed', 'CYCLIC');
      return false;
    }
    const layouts: ScopeLayoutPositions[] = [];

    for (const [index, task] of tasks.entries()) {
      measurementStore.selectFlow(task.flowId);
      measurementStore.scopePath.value = task.path;
      const flow = measurementStore.selectedFlow;
      const graph = measurementStore.currentGraph;
      if (!flow || !graph) {
        emit('failed', 'UNAVAILABLE');
        return false;
      }
      const rootResolved = resolveEditorScope(source.agent, flow, [], props.registry)?.resolved;
      const resolved = resolveEditorScope(source.agent, flow, task.path, props.registry)?.resolved;
      if (!rootResolved || !resolved) {
        emit('failed', 'UNAVAILABLE');
        return false;
      }
      const rendered = toVueFlow(graph, resolved, new Set(), new Set());
      measurement.value = {
        store: measurementStore,
        flow,
        graph,
        nodes: rendered.nodes.flatMap((node) => (node.data ? [node.data] : [])),
        resolved,
        rootResolved,
      };
      await nextTick();
      await nextRenderFrame();
      await nextTick();
      const result = smartLayout(
        graph,
        measuredNodeDimensions(graph.nodes.map((node) => node.id)),
        layoutPortOrders(graph, resolved),
      );
      if (!result.available) {
        emit('failed', result.reason);
        return false;
      }
      layouts.push({ flowId: task.flowId, scopePath: task.path, positions: result.positions });
      emit('progress', index + 1, tasks.length);
    }

    props.store.layoutScopes(layouts);
    emit('succeeded');
    return true;
  } catch {
    emit('failed', 'UNAVAILABLE');
    return false;
  } finally {
    measurement.value = undefined;
    running = false;
    emit('busy', false);
  }
}

defineExpose({ applySmartLayoutAll });
</script>

<template>
  <div ref="measurementRoot" class="custom-agent-flow__layout-measure" aria-hidden="true">
    <div
      v-for="node in measurement?.nodes ?? []"
      :key="node.node.id"
      data-layout-node
      :style="{
        width: `${node.renderSize?.width ?? GRAPH_NODE_MIN_WIDTH}px`,
        height: node.renderSize ? `${node.renderSize.height}px` : undefined,
      }"
    >
      <NodeCard
        :data="node"
        :registry="registry"
        :store="measurement!.store"
        :flow="measurement!.flow"
        :graph="measurement!.graph"
        :all-resolved="measurement!.resolved"
        :root-resolved="measurement!.rootResolved"
      />
    </div>
  </div>
</template>
