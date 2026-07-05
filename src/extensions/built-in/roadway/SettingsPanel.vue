<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Select, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import PromptPresetField from '../PromptPresetField.vue';
import {
  BUILT_IN_PROMPT_PRESETS,
  DEFAULT_SETTINGS,
  type RoadwayChatExtra,
  type RoadwayMessageExtra,
  type RoadwaySettings,
  migrateRoadwaySettings,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<RoadwaySettings, RoadwayChatExtra, RoadwayMessageExtra>;
}>();

const t = props.api.i18n.t;

const settings = ref<RoadwaySettings>({ ...DEFAULT_SETTINGS });

onMounted(() => {
  settings.value = migrateRoadwaySettings(props.api.settings.get());
});

watch(
  settings,
  (newSettings) => {
    props.api.settings.set(undefined, newSettings);
    // @ts-expect-error custom event
    props.api.events.emit('roadway:settings-changed');
    props.api.settings.save();
  },
  { deep: true },
);

const formatOptions = [
  { label: t('extensionsBuiltin.roadway.requestFormats.native'), value: 'native' },
  { label: t('extensionsBuiltin.roadway.requestFormats.json'), value: 'json' },
  { label: t('extensionsBuiltin.roadway.requestFormats.xml'), value: 'xml' },
];

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;
</script>

<template>
  <div class="roadway-settings">
    <div class="group-header">{{ t('common.general') }}</div>
    <FormItem :label="t('extensionsBuiltin.roadway.enable')">
      <Toggle v-model="settings.enabled" />
    </FormItem>
    <FormItem
      :label="t('extensionsBuiltin.roadway.autoGenerateChoices')"
      :description="t('extensionsBuiltin.roadway.autoGenerateChoicesHint')"
    >
      <Toggle v-model="settings.autoMode" />
    </FormItem>

    <div class="group-header">{{ t('extensionsBuiltin.roadway.choiceGeneration') }}</div>
    <FormItem
      :label="t('extensionsBuiltin.roadway.connectionProfile')"
      :description="t('extensionsBuiltin.roadway.choiceConnectionProfileHint')"
    >
      <ConnectionProfileSelector v-model="settings.choiceGenConnectionProfile" />
    </FormItem>
    <FormItem
      :label="t('extensionsBuiltin.roadway.numberOfChoices')"
      :description="t('extensionsBuiltin.roadway.numberOfChoicesHint')"
    >
      <Input v-model.number="settings.choiceCount" type="number" :min="1" :max="20" />
    </FormItem>
    <FormItem
      :label="t('extensionsBuiltin.roadway.requestFormat')"
      :description="t('extensionsBuiltin.roadway.requestFormatHint')"
    >
      <Select v-model="settings.structuredRequestFormat" :options="formatOptions" />
    </FormItem>
    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="choiceGenPrompt"
      :label="t('extensionsBuiltin.roadway.promptTemplate')"
      :description="t('extensionsBuiltin.roadway.choicePromptHint')"
      identifier="extension.roadway.choiceGenPrompt"
      :rows="6"
      @update:active-preset-id="settings.activePromptPresetId = $event"
      @update:prompt-presets="settings.promptPresets = $event"
    />

    <div class="group-header">{{ t('extensionsBuiltin.roadway.impersonateAction') }}</div>
    <FormItem
      :label="t('extensionsBuiltin.roadway.connectionProfile')"
      :description="t('extensionsBuiltin.roadway.impersonateConnectionProfileHint')"
    >
      <ConnectionProfileSelector v-model="settings.impersonateConnectionProfile" />
    </FormItem>
    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="impersonatePrompt"
      :label="t('extensionsBuiltin.roadway.promptTemplate')"
      :description="t('extensionsBuiltin.roadway.impersonatePromptHint')"
      identifier="extension.roadway.impersonatePrompt"
      :rows="6"
      @update:active-preset-id="settings.activePromptPresetId = $event"
      @update:prompt-presets="settings.promptPresets = $event"
    />
  </div>
</template>

<style scoped>
.roadway-settings {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
}
.group-header {
  font-weight: bold;
  font-size: 1.1em;
  color: var(--theme-text-color-primary);
  border-bottom: 1px solid var(--theme-border-color);
  padding-bottom: var(--spacing-xs);
  margin-top: var(--spacing-md);
}
</style>
