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
const t = props.api.i18n.t;

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
  { label: t('extensionsBuiltin.worldMap.autoModes.none'), value: 'none' },
  { label: t('extensionsBuiltin.worldMap.autoModes.responses'), value: 'responses' },
  { label: t('extensionsBuiltin.worldMap.autoModes.inputs'), value: 'inputs' },
  { label: t('extensionsBuiltin.worldMap.autoModes.both'), value: 'both' },
];

const formatOptions = [
  { label: t('extensionsBuiltin.worldMap.requestFormats.native'), value: 'native' },
  { label: t('extensionsBuiltin.worldMap.requestFormats.json'), value: 'json' },
  { label: t('extensionsBuiltin.worldMap.requestFormats.xml'), value: 'xml' },
];

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;
</script>

<template>
  <div class="world-map-settings">
    <div class="world-map-settings__group">{{ t('common.general') }}</div>
    <FormItem :label="t('extensionsBuiltin.worldMap.enable')">
      <Toggle v-model="settings.enabled" />
    </FormItem>
    <FormItem
      :label="t('extensionsBuiltin.worldMap.autoUpdate')"
      :description="t('extensionsBuiltin.worldMap.autoUpdateHint')"
    >
      <Select v-model="settings.autoMode" :options="autoModeOptions" />
    </FormItem>
    <FormItem
      :label="t('extensionsBuiltin.worldMap.connectionProfile')"
      :description="t('extensionsBuiltin.worldMap.connectionProfileHint')"
    >
      <ConnectionProfileSelector v-model="settings.connectionProfile" />
    </FormItem>
    <FormItem :label="t('extensionsBuiltin.worldMap.structuredRequestFormat')">
      <Select v-model="settings.structuredRequestFormat" :options="formatOptions" />
    </FormItem>
    <div class="world-map-settings__group">{{ t('extensionsBuiltin.worldMap.limits') }}</div>
    <FormItem
      :label="t('extensionsBuiltin.worldMap.recentMessages')"
      :description="t('extensionsBuiltin.worldMap.recentMessagesHint')"
    >
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
      :label="t('extensionsBuiltin.worldMap.includeActiveLorebooksOnCreate')"
      :description="t('extensionsBuiltin.worldMap.includeActiveLorebooksOnCreateHint')"
    >
      <Toggle v-model="settings.includeActiveLorebookEntriesOnCreate" />
    </FormItem>
    <FormItem :label="t('extensionsBuiltin.worldMap.maxResponseTokens')">
      <Input v-model.number="settings.maxResponseTokens" type="number" :min="512" :max="64000" />
    </FormItem>
    <FormItem :label="t('extensionsBuiltin.worldMap.maxNodesPerDelta')">
      <Input v-model.number="settings.maxNodesPerDelta" type="number" :min="4" :max="900" />
    </FormItem>
    <FormItem :label="t('extensionsBuiltin.worldMap.maxRoutesPerDelta')">
      <Input v-model.number="settings.maxRoutesPerDelta" type="number" :min="4" :max="1500" />
    </FormItem>
    <FormItem :label="t('extensionsBuiltin.worldMap.maxVisualAssetsPerDelta')">
      <Input v-model.number="settings.maxVisualAssetsPerDelta" type="number" :min="0" :max="300" />
    </FormItem>

    <div class="world-map-settings__group">{{ t('extensionsBuiltin.worldMap.aiPrompt') }}</div>
    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="updatePrompt"
      :label="t('extensionsBuiltin.worldMap.updatePrompt')"
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
