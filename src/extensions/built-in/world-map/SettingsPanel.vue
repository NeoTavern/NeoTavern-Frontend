<script setup lang="ts">
import { FormItem, Select, Toggle } from '../../../components/UI';
import ConnectionProfileField from '../_shared/components/ConnectionProfileField.vue';
import NumberSettingField from '../_shared/components/NumberSettingField.vue';
import PromptPresetField from '../_shared/components/PromptPresetField.vue';
import { createStructuredRequestFormatOptions } from '../_shared/runtime/structured-request-format';
import { useExtensionSettings } from '../_shared/composables/use-extension-settings';
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

const t = props.api.i18n.t;
const settings = useExtensionSettings<WorldMapSettings>(props.api, { ...DEFAULT_SETTINGS }, migrateWorldMapSettings);

const autoModeOptions = [
  { label: t('extensionsBuiltin.worldMap.autoModes.none'), value: 'none' },
  { label: t('extensionsBuiltin.worldMap.autoModes.responses'), value: 'responses' },
  { label: t('extensionsBuiltin.worldMap.autoModes.inputs'), value: 'inputs' },
  { label: t('extensionsBuiltin.worldMap.autoModes.both'), value: 'both' },
];

const formatOptions = createStructuredRequestFormatOptions({
  native: t('extensionsBuiltin.worldMap.requestFormats.native'),
  json: t('extensionsBuiltin.worldMap.requestFormats.json'),
  xml: t('extensionsBuiltin.worldMap.requestFormats.xml'),
});

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
    <ConnectionProfileField
      v-model="settings.connectionProfile"
      :label="t('extensionsBuiltin.worldMap.connectionProfile')"
      :description="t('extensionsBuiltin.worldMap.connectionProfileHint')"
    />
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
    <NumberSettingField
      v-model="settings.maxResponseTokens"
      :label="t('extensionsBuiltin.worldMap.maxResponseTokens')"
      :min="512"
      :max="64000"
    />
    <NumberSettingField
      v-model="settings.maxNodesPerDelta"
      :label="t('extensionsBuiltin.worldMap.maxNodesPerDelta')"
      :min="4"
      :max="900"
    />
    <NumberSettingField
      v-model="settings.maxRoutesPerDelta"
      :label="t('extensionsBuiltin.worldMap.maxRoutesPerDelta')"
      :min="4"
      :max="1500"
    />
    <NumberSettingField
      v-model="settings.maxVisualAssetsPerDelta"
      :label="t('extensionsBuiltin.worldMap.maxVisualAssetsPerDelta')"
      :min="0"
      :max="300"
    />

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
