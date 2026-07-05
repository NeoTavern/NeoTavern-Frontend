<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Select, Toggle } from '../../../components/UI';
import PromptPresetField from '../PromptPresetField.vue';
import {
  BUILT_IN_PROMPT_PRESETS,
  DEFAULT_SETTINGS,
  type WorldMapExtensionAPI,
  type WorldMapSettings,
  migrateWorldMapSettings,
} from './types';

const props = defineProps<{
  api: WorldMapExtensionAPI;
}>();

const settings = ref<WorldMapSettings>({ ...DEFAULT_SETTINGS });

onMounted(() => {
  settings.value = migrateWorldMapSettings(props.api.settings.get());
});

watch(
  settings,
  (value) => {
    props.api.settings.set(undefined, value);
    props.api.settings.save();
  },
  { deep: true },
);

const autoModeOptions = [
  { label: 'None', value: 'none' },
  { label: 'AI responses', value: 'responses' },
  { label: 'User inputs', value: 'inputs' },
  { label: 'Both', value: 'both' },
];

const formatOptions = [
  { label: 'Native', value: 'native' },
  { label: 'JSON', value: 'json' },
  { label: 'XML', value: 'xml' },
];

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;
</script>

<template>
  <div class="world-map-settings">
    <div class="world-map-settings__group">General</div>
    <FormItem label="Enable World Map">
      <Toggle v-model="settings.enabled" />
    </FormItem>
    <FormItem
      label="Auto-update"
      description="Optional AI updates after new chat messages. Manual create/update remains available from message buttons and chat actions."
    >
      <Select v-model="settings.autoMode" :options="autoModeOptions" />
    </FormItem>
    <FormItem label="Connection Profile" description="Overrides the chat connection profile for map generation.">
      <ConnectionProfileSelector v-model="settings.connectionProfile" />
    </FormItem>
    <FormItem label="Structured Request Format">
      <Select v-model="settings.structuredRequestFormat" :options="formatOptions" />
    </FormItem>
    <div class="world-map-settings__group">Limits</div>
    <FormItem label="Recent Messages" description="Use -1 to include all messages up to the selected message.">
      <input
        v-model.number="settings.includeLastXMessages"
        class="text-pole"
        type="number"
        :min="-1"
        :max="100"
        :step="1"
      />
    </FormItem>
    <FormItem
      label="Include Active Lorebooks On Create"
      description="When no map exists yet, include every enabled entry from active lorebooks in the map creation request."
    >
      <Toggle v-model="settings.includeActiveLorebookEntriesOnCreate" />
    </FormItem>
    <FormItem label="Max Response Tokens">
      <Input v-model.number="settings.maxResponseTokens" type="number" :min="512" :max="64000" />
    </FormItem>
    <FormItem label="Max Nodes Per Delta">
      <Input v-model.number="settings.maxNodesPerDelta" type="number" :min="4" :max="900" />
    </FormItem>
    <FormItem label="Max Routes Per Delta">
      <Input v-model.number="settings.maxRoutesPerDelta" type="number" :min="4" :max="1500" />
    </FormItem>
    <FormItem label="Max Visual Assets Per Delta">
      <Input v-model.number="settings.maxVisualAssetsPerDelta" type="number" :min="0" :max="300" />
    </FormItem>

    <div class="world-map-settings__group">AI Prompt</div>
    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="updatePrompt"
      label="Update Prompt"
      identifier="extension.world-map.updatePrompt"
      :rows="12"
      @update:active-preset-id="settings.activePromptPresetId = $event"
      @update:prompt-presets="settings.promptPresets = $event"
    />
  </div>
</template>

<style scoped>
.world-map-settings {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
}

.world-map-settings__group {
  padding-bottom: var(--spacing-xs);
  border-bottom: 1px solid var(--theme-border-color);
  color: var(--theme-text-color-primary);
  font-size: 1.05rem;
  font-weight: 700;
}
</style>
