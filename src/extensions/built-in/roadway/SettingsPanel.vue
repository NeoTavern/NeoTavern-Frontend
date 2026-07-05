<script setup lang="ts">
import { FormItem, Select, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import ConnectionProfileField from '../_shared/components/ConnectionProfileField.vue';
import NumberSettingField from '../_shared/components/NumberSettingField.vue';
import PromptPresetField from '../_shared/components/PromptPresetField.vue';
import { createStructuredRequestFormatOptions } from '../_shared/runtime/structured-request-format';
import { useExtensionSettings } from '../_shared/composables/use-extension-settings';
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
const settings = useExtensionSettings<RoadwaySettings>(props.api, { ...DEFAULT_SETTINGS }, migrateRoadwaySettings, {
  onBeforeSave: () => {
    // @ts-expect-error custom event
    props.api.events.emit('roadway:settings-changed');
  },
});

const formatOptions = createStructuredRequestFormatOptions({
  native: t('extensionsBuiltin.roadway.requestFormats.native'),
  json: t('extensionsBuiltin.roadway.requestFormats.json'),
  xml: t('extensionsBuiltin.roadway.requestFormats.xml'),
});

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
    <ConnectionProfileField
      v-model="settings.choiceGenConnectionProfile"
      :label="t('extensionsBuiltin.roadway.connectionProfile')"
      :description="t('extensionsBuiltin.roadway.choiceConnectionProfileHint')"
    />
    <NumberSettingField
      v-model="settings.choiceCount"
      :label="t('extensionsBuiltin.roadway.numberOfChoices')"
      :description="t('extensionsBuiltin.roadway.numberOfChoicesHint')"
      :min="1"
      :max="20"
    />
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
    <ConnectionProfileField
      v-model="settings.impersonateConnectionProfile"
      :label="t('extensionsBuiltin.roadway.connectionProfile')"
      :description="t('extensionsBuiltin.roadway.impersonateConnectionProfileHint')"
    />
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
