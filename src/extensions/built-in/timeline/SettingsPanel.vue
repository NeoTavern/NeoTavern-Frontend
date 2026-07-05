<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Select, Toggle } from '../../../components/UI';
import PromptPresetField from '../PromptPresetField.vue';
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
const settings = ref<TimelineSettings>({ ...DEFAULT_SETTINGS });

onMounted(() => {
  settings.value = migrateTimelineSettings(props.api.settings.get());
});

watch(
  settings,
  (value) => {
    props.api.settings.set(undefined, value);
    props.api.settings.save();
  },
  { deep: true },
);

const formatOptions = [
  { label: t('extensionsBuiltin.timeline.requestFormats.native'), value: 'native' },
  { label: t('extensionsBuiltin.timeline.requestFormats.json'), value: 'json' },
  { label: t('extensionsBuiltin.timeline.requestFormats.xml'), value: 'xml' },
];

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;
</script>

<template>
  <div class="timeline-settings">
    <div class="timeline-settings__group">{{ t('common.general') }}</div>
    <FormItem :label="t('extensionsBuiltin.timeline.enable')">
      <Toggle v-model="settings.enabled" />
    </FormItem>
    <FormItem
      :label="t('extensionsBuiltin.timeline.connectionProfile')"
      :description="t('extensionsBuiltin.timeline.connectionProfileHint')"
    >
      <ConnectionProfileSelector v-model="settings.connectionProfile" />
    </FormItem>
    <FormItem :label="t('extensionsBuiltin.timeline.structuredRequestFormat')">
      <Select v-model="settings.structuredRequestFormat" :options="formatOptions" />
    </FormItem>

    <div class="timeline-settings__group">{{ t('extensionsBuiltin.timeline.limits') }}</div>
    <FormItem
      :label="t('extensionsBuiltin.timeline.recentMessages')"
      :description="t('extensionsBuiltin.timeline.recentMessagesHint')"
    >
      <Input v-model.number="settings.includeLastXMessages" type="number" :min="-1" :max="500" />
    </FormItem>
    <FormItem :label="t('extensionsBuiltin.timeline.maxResponseTokens')">
      <Input v-model.number="settings.maxResponseTokens" type="number" :min="512" :max="32000" />
    </FormItem>
    <div class="timeline-settings__row">
      <FormItem
        :label="t('extensionsBuiltin.timeline.dueInjected')"
        :description="t('extensionsBuiltin.timeline.dueInjectedHint')"
      >
        <Input v-model.number="settings.maxDueInjected" type="number" :min="-1" :max="20" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.timeline.upcomingInjected')"
        :description="t('extensionsBuiltin.timeline.upcomingInjectedHint')"
      >
        <Input v-model.number="settings.maxUpcomingInjected" type="number" :min="-1" :max="20" />
      </FormItem>
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
