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
  type TimelineExtensionAPI,
  type TimelineSettings,
  migrateTimelineSettings,
} from './types';

const props = defineProps<{
  api: TimelineExtensionAPI;
}>();

const t = props.api.i18n.t;
const settings = useExtensionSettings<TimelineSettings>(props.api, { ...DEFAULT_SETTINGS }, migrateTimelineSettings);

const formatOptions = createStructuredRequestFormatOptions({
  native: t('extensionsBuiltin.timeline.requestFormats.native'),
  json: t('extensionsBuiltin.timeline.requestFormats.json'),
  xml: t('extensionsBuiltin.timeline.requestFormats.xml'),
});

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;
</script>

<template>
  <div class="timeline-settings">
    <div class="timeline-settings__group">{{ t('common.general') }}</div>
    <FormItem :label="t('extensionsBuiltin.timeline.enable')">
      <Toggle v-model="settings.enabled" />
    </FormItem>
    <ConnectionProfileField
      v-model="settings.connectionProfile"
      :label="t('extensionsBuiltin.timeline.connectionProfile')"
      :description="t('extensionsBuiltin.timeline.connectionProfileHint')"
    />
    <FormItem :label="t('extensionsBuiltin.timeline.structuredRequestFormat')">
      <Select v-model="settings.structuredRequestFormat" :options="formatOptions" />
    </FormItem>

    <div class="timeline-settings__group">{{ t('extensionsBuiltin.timeline.limits') }}</div>
    <NumberSettingField
      v-model="settings.includeLastXMessages"
      :label="t('extensionsBuiltin.timeline.recentMessages')"
      :description="t('extensionsBuiltin.timeline.recentMessagesHint')"
      :min="-1"
      :max="500"
    />
    <NumberSettingField
      v-model="settings.maxResponseTokens"
      :label="t('extensionsBuiltin.timeline.maxResponseTokens')"
      :min="512"
      :max="32000"
    />
    <div class="timeline-settings__row">
      <NumberSettingField
        v-model="settings.maxDueInjected"
        :label="t('extensionsBuiltin.timeline.dueInjected')"
        :description="t('extensionsBuiltin.timeline.dueInjectedHint')"
        :min="-1"
        :max="20"
      />
      <NumberSettingField
        v-model="settings.maxUpcomingInjected"
        :label="t('extensionsBuiltin.timeline.upcomingInjected')"
        :description="t('extensionsBuiltin.timeline.upcomingInjectedHint')"
        :min="-1"
        :max="20"
      />
    </div>

    <div class="timeline-settings__group">{{ t('extensionsBuiltin.timeline.aiPrompt') }}</div>
    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="extractionPrompt"
      :label="t('extensionsBuiltin.timeline.extractionPrompt')"
      identifier="extension.timeline.extractionPrompt"
      :rows="14"
      @update:active-preset-id="settings.activePromptPresetId = $event"
      @update:prompt-presets="settings.promptPresets = $event"
    />
  </div>
</template>

<style scoped>
.timeline-settings {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
}

.timeline-settings__group {
  padding-bottom: var(--spacing-xs);
  border-bottom: 1px solid var(--theme-border-color);
  color: var(--theme-text-color-primary);
  font-size: 1.05rem;
  font-weight: 700;
}

.timeline-settings__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-md);
}
</style>
