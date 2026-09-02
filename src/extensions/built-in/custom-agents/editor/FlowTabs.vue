<script setup lang="ts">
import { ref } from 'vue';
import { Button, Input } from '../../../../components/UI';
import type { GraphFlow } from '../graph/contracts';
import { useEditorI18n } from './editor-i18n';

const props = defineProps<{ flows: readonly GraphFlow[]; selectedId: string }>();
const emit = defineEmits<{
  select: [id: string];
  create: [kind: GraphFlow['kind']];
  duplicate: [id: string];
  rename: [id: string, name: string];
  remove: [id: string];
}>();
const editing = ref('');
const name = ref('');
const { t } = useEditorI18n();
function begin(flow: GraphFlow) {
  editing.value = flow.id;
  name.value = flow.name;
}
function finish() {
  if (editing.value && name.value.trim()) emit('rename', editing.value, name.value.trim());
  editing.value = '';
}
</script>

<template>
  <nav class="custom-agent-flow__tabs" :aria-label="t('extensionsBuiltin.customAgents.editor.flows')">
    <div v-for="flow in props.flows" :key="flow.id" :class="{ 'is-active': flow.id === selectedId }">
      <Input v-if="editing === flow.id" v-model="name" @change="finish" />
      <Button
        v-else
        type="button"
        :title="t('extensionsBuiltin.customAgents.editor.selectFlow', { name: flow.name })"
        @click="emit('select', flow.id)"
        @dblclick="begin(flow)"
      >
        <small>{{ t(`extensionsBuiltin.customAgents.editor.flowKinds.${flow.kind.toLowerCase()}`) }}</small>
        {{ flow.name }}
      </Button>
      <Button
        icon="fa-copy"
        :title="t('extensionsBuiltin.customAgents.editor.duplicateFlow')"
        @click="emit('duplicate', flow.id)"
      />
      <Button
        variant="danger"
        icon="fa-trash"
        :title="t('extensionsBuiltin.customAgents.editor.deleteFlow')"
        @click="emit('remove', flow.id)"
      />
    </div>
    <Button
      icon="fa-plus"
      :title="t('extensionsBuiltin.customAgents.editor.createTriggerFlow')"
      @click="emit('create', 'TRIGGER')"
      >{{ t('extensionsBuiltin.customAgents.editor.flowKinds.trigger') }}</Button
    >
    <Button
      icon="fa-plus"
      :title="t('extensionsBuiltin.customAgents.editor.createSubflow')"
      @click="emit('create', 'SUBFLOW')"
      >{{ t('extensionsBuiltin.customAgents.editor.flowKinds.subflow') }}</Button
    >
  </nav>
</template>
