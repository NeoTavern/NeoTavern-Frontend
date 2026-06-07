<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Select, Textarea, Toggle } from '../../../components/UI';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
import {
  DEFAULT_EXTRACTION_PROMPT,
  DEFAULT_SETTINGS,
  type TimelineExtensionAPI,
  type TimelineSettings,
} from './types';

const props = defineProps<{
  api: TimelineExtensionAPI;
}>();

const settings = ref<TimelineSettings>({ ...DEFAULT_SETTINGS });
const t = props.api.i18n.t;

onMounted(() => {
  settings.value = { ...DEFAULT_SETTINGS, ...props.api.settings.get() };
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
  { label: 'Native', value: 'native' },
  { label: 'JSON', value: 'json' },
  { label: 'XML', value: 'xml' },
];

const resetPromptTools = computed(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    onClick: async ({ setValue }: { setValue: (value: string) => void }) => {
      const { result } = await props.api.ui.showPopup({
        title: 'Reset Timeline Prompt?',
        content: 'Reset the timeline extraction prompt to its default value?',
        type: POPUP_TYPE.CONFIRM,
        okButton: 'common.reset',
        cancelButton: 'common.cancel',
      });
      if (result === POPUP_RESULT.AFFIRMATIVE) {
        setValue(DEFAULT_EXTRACTION_PROMPT);
        props.api.ui.showToast('Timeline prompt reset.', 'success');
      }
    },
  },
]);
</script>

<template>
  <div class="timeline-settings">
    <div class="timeline-settings__group">General</div>
    <FormItem label="Enable Timeline">
      <Toggle v-model="settings.enabled" />
    </FormItem>
    <FormItem label="Connection Profile" description="Overrides the chat connection profile for extraction.">
      <ConnectionProfileSelector v-model="settings.connectionProfile" />
    </FormItem>
    <FormItem label="Structured Request Format">
      <Select v-model="settings.structuredRequestFormat" :options="formatOptions" />
    </FormItem>

    <div class="timeline-settings__group">Limits</div>
    <FormItem label="Recent Messages" description="Use -1 to include the full current chat context.">
      <Input v-model.number="settings.includeLastXMessages" type="number" :min="-1" :max="500" />
    </FormItem>
    <FormItem label="Max Response Tokens">
      <Input v-model.number="settings.maxResponseTokens" type="number" :min="512" :max="32000" />
    </FormItem>
    <div class="timeline-settings__row">
      <FormItem label="Due Injected" description="Maximum due events injected into prompt context. Use -1 for all.">
        <Input v-model.number="settings.maxDueInjected" type="number" :min="-1" :max="20" />
      </FormItem>
      <FormItem
        label="Upcoming Injected"
        description="Maximum upcoming events injected into prompt context. Use -1 for all."
      >
        <Input v-model.number="settings.maxUpcomingInjected" type="number" :min="-1" :max="20" />
      </FormItem>
    </div>

    <div class="timeline-settings__group">AI Prompt</div>
    <FormItem label="Extraction Prompt">
      <Textarea
        v-model="settings.extractionPrompt"
        allow-maximize
        :rows="14"
        identifier="extension.timeline.extractionPrompt"
        :tools="resetPromptTools"
      />
    </FormItem>
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
