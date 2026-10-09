<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { computed } from 'vue';
import type { GraphFlow, ScopeGraph } from '../graph/contracts';
import { schemaValueType } from '../graph/schema-ports';
import type { ReadonlyNodeRegistry } from '../registry/node-definition';
import type { GraphEditorStore } from './editor-store';
import NodeCard from './NodeCard.vue';
import type { EditorNodeData, EditorPortDefinition, ResolvedEditorNode } from './vue-flow-adapter';
import { useEditorI18n } from './editor-i18n';

const props = defineProps<{
  data: EditorNodeData;
  registry: ReadonlyNodeRegistry;
  store: GraphEditorStore;
  flow: GraphFlow;
  graph: ScopeGraph;
  allResolved: ReadonlyMap<string, ResolvedEditorNode>;
  rootResolved: ReadonlyMap<string, ResolvedEditorNode>;
  selected?: boolean;
}>();
const emit = defineEmits<{
  openBody: [nodeId: string];
  resizeStart: [payload: { nodeId: string; event: PointerEvent }];
}>();
const { t, translateKey } = useEditorI18n();
const portLabel = (port: EditorPortDefinition) =>
  port.stale
    ? t('extensionsBuiltin.customAgents.editor.stalePort', { label: port.labelKey })
    : port.literalLabel
      ? port.labelKey
      : translateKey(port.labelKey);
const portTitle = (port: EditorPortDefinition) =>
  `${portLabel(port)} (${t(
    `extensionsBuiltin.customAgents.editor.portKinds.${port.kind === 'DATA' ? schemaValueType(port.schema).toLowerCase() : 'control'}`,
  )})`;
const portPosition = (index: number, count: number) => `${((index + 1) / (count + 1)) * 100}%`;
const portClass = (port: EditorPortDefinition) =>
  port.kind === 'CONTROL' ? 'is-control' : `is-${schemaValueType(port.schema).toLowerCase()}`;
const shellInputs = computed(() => props.data.inputs.filter((port) => port.kind === 'CONTROL'));
</script>

<template>
  <NodeCard v-bind="props" @open-body="emit('openBody', $event)" @resize-start="emit('resizeStart', $event)">
    <Handle
      v-for="(port, index) in shellInputs"
      :id="port.id"
      :key="`input:${port.id}`"
      type="target"
      :position="Position.Left"
      :class="portClass(port)"
      :style="{ top: portPosition(index, shellInputs.length) }"
      :title="portTitle(port)"
    />
    <Handle
      v-for="(port, index) in data.outputs"
      :id="port.id"
      :key="`output:${port.id}`"
      type="source"
      :position="Position.Right"
      :class="portClass(port)"
      :style="{ top: portPosition(index, data.outputs.length) }"
      :title="portTitle(port)"
    />
  </NodeCard>
</template>
