<script setup lang="ts">
import { Button, Input, Textarea, Toggle } from '../../../../components/UI';
import type { GraphEditorStore } from './editor-store';
import { useEditorI18n } from './editor-i18n';

const props = defineProps<{ store: GraphEditorStore }>();
const directions = ['inputs', 'outputs'] as const;
const { t } = useEditorI18n();
</script>

<template>
  <aside
    v-if="store.selectedFlow?.kind === 'SUBFLOW' && store.scopePath.value.length === 0"
    class="custom-agent-flow__signature"
    :aria-label="t('extensionsBuiltin.customAgents.editor.subflowSignature')"
  >
    <section v-for="direction in directions" :key="direction" :data-signature-direction="direction">
      <h2>{{ t(`extensionsBuiltin.customAgents.editor.${direction}`) }}</h2>
      <div
        v-for="(port, index) in store.selectedFlow[direction]"
        :key="port.id"
        class="custom-agent-flow__signature-port"
        :data-port-id="port.id"
      >
        <Input
          :model-value="port.id"
          :label="t('extensionsBuiltin.customAgents.editor.id')"
          @update:model-value="store.updateFlowPort(direction, port.id, 'id', String($event))"
        />
        <Input
          :model-value="port.label"
          :label="t('extensionsBuiltin.customAgents.editor.label')"
          @update:model-value="store.updateFlowPort(direction, port.id, 'label', String($event))"
        />
        <Toggle
          :model-value="port.required"
          :label="t('extensionsBuiltin.customAgents.editor.required')"
          @update:model-value="store.updateFlowPort(direction, port.id, 'required', $event)"
        />
        <Textarea
          :model-value="store.flowPortSchemaText(direction, port)"
          :label="t('extensionsBuiltin.customAgents.editor.jsonSchema')"
          @update:model-value="store.updateFlowPortSchemaText(direction, port.id, $event)"
        />
        <Button
          icon="fa-arrow-up"
          :title="t('extensionsBuiltin.customAgents.editor.movePortUp')"
          :disabled="index === 0"
          @click="store.moveFlowPort(direction, port.id, -1)"
        />
        <Button
          icon="fa-arrow-down"
          :title="t('extensionsBuiltin.customAgents.editor.movePortDown')"
          :disabled="index === store.selectedFlow[direction].length - 1"
          @click="store.moveFlowPort(direction, port.id, 1)"
        />
        <Button
          variant="danger"
          icon="fa-trash"
          :title="t('extensionsBuiltin.customAgents.editor.removePort')"
          @click="store.removeFlowPort(direction, port.id)"
        />
      </div>
      <Button
        icon="fa-plus"
        :title="t(`extensionsBuiltin.customAgents.editor.add${direction === 'inputs' ? 'Input' : 'Output'}`)"
        @click="store.addFlowPort(direction)"
      >
        {{ t(`extensionsBuiltin.customAgents.editor.add${direction === 'inputs' ? 'Input' : 'Output'}`) }}
      </Button>
    </section>
  </aside>
</template>
