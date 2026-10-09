<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '../../../../components/UI';
import type { GraphFlow, ScopeGraph } from '../graph/contracts';
import type { ReadonlyNodeRegistry } from '../registry/node-definition';
import type { GraphEditorStore } from './editor-store';
import NodeDetails from './NodeDetails.vue';
import NodeRunOverlay from './NodeRunOverlay.vue';
import type { EditorNodeData, ResolvedEditorNode } from './vue-flow-adapter';
import { useEditorI18n } from './editor-i18n';

const props = withDefaults(
  defineProps<{
    data: EditorNodeData;
    registry: ReadonlyNodeRegistry;
    store: GraphEditorStore;
    flow: GraphFlow;
    graph: ScopeGraph;
    allResolved: ReadonlyMap<string, ResolvedEditorNode>;
    rootResolved: ReadonlyMap<string, ResolvedEditorNode>;
    selected?: boolean;
    portHandles?: boolean;
  }>(),
  { portHandles: true },
);
const emit = defineEmits<{
  openBody: [nodeId: string];
  resizeStart: [payload: { nodeId: string; event: PointerEvent }];
}>();
const { t, translateKey } = useEditorI18n();
const definition = computed(() => props.registry.get(props.data.node.type));
const nodeLabel = computed(() => (definition.value ? translateKey(definition.value.labelKey) : props.data.label));
const dataSize = computed(() => props.data.renderSize);
const heightConstrained = computed(() => dataSize.value !== undefined);
</script>

<template>
  <article
    class="custom-agent-flow__node"
    :class="{
      'is-selected': selected,
      'is-invalid': data.invalid,
      'is-height-constrained': heightConstrained,
    }"
    :data-node-id="data.node.id"
  >
    <header :title="definition ? translateKey(definition.descriptionKey) : undefined">{{ nodeLabel }}</header>
    <code>{{ data.node.id }}</code>
    <div class="custom-agent-flow__node-inspector">
      <NodeDetails
        :store="store"
        :registry="registry"
        :flow="flow"
        :graph="graph"
        :resolved="data"
        :all-resolved="allResolved"
        :root-resolved="rootResolved"
        :show-port-handles="portHandles !== false"
        @open-body="emit('openBody', $event)"
      />
    </div>
    <slot />
    <NodeRunOverlay :record="data.runRecord" />
    <Button
      v-if="selected"
      class="custom-agent-flow__resize-grip nodrag nowheel"
      icon="fa-up-right-and-down-left-from-center"
      :title="t('extensionsBuiltin.customAgents.editor.resizeNode')"
      @pointerdown.stop.prevent="emit('resizeStart', { nodeId: data.node.id, event: $event })"
    />
  </article>
</template>
