<script setup lang="ts">
import { Input } from '../../../../components/UI';
import type { GraphPreset } from '../graph/contracts';
import type { CustomAgentsHostAPI } from '../host/api';

const props = defineProps<{ preset: GraphPreset; t: CustomAgentsHostAPI['i18n']['t'] }>();
const emit = defineEmits<{ rename: [name: string]; priority: [priority: number] }>();
</script>

<template>
  <fieldset class="custom-agent-panel">
    <legend>{{ t('extensionsBuiltin.customAgents.metadata') }}</legend>
    <Input :label="t('extensionsBuiltin.customAgents.id')" :model-value="preset.agent.id" disabled />
    <Input
      :label="t('extensionsBuiltin.customAgents.name')"
      :model-value="preset.agent.name"
      @change="emit('rename', ($event.target as HTMLInputElement).value)"
    />
    <Input
      :label="t('extensionsBuiltin.customAgents.priority')"
      type="number"
      :model-value="preset.agent.priority"
      @change="emit('priority', Number(($event.target as HTMLInputElement).value))"
    />
  </fieldset>
</template>
