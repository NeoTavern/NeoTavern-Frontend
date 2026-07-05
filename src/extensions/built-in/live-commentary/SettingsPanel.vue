<script setup lang="ts">
import { computed, ref } from 'vue';
import { FormItem, Input, Select, Textarea, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import type { TextareaToolDefinition } from '../../../types/ExtensionAPI';
import ConnectionProfileField from '../_shared/components/ConnectionProfileField.vue';
import PromptPresetField from '../_shared/components/PromptPresetField.vue';
import { useExtensionSettings } from '../_shared/composables/use-extension-settings';
import {
  BUILT_IN_PROMPT_PRESETS,
  DEFAULT_INJECTION_TEMPLATE,
  DEFAULT_SETTINGS,
  type LiveCommentarySettings,
  migrateLiveCommentarySettings,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<LiveCommentarySettings>;
}>();

const t = props.api.i18n.t;

const showNote = ref(true);
const settings = useExtensionSettings<LiveCommentarySettings>(
  props.api,
  { ...DEFAULT_SETTINGS },
  migrateLiveCommentarySettings,
);

const injectionTools = computed<TextareaToolDefinition[]>(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    onClick: ({ setValue }) => {
      setValue(DEFAULT_INJECTION_TEMPLATE);
    },
  },
]);

const positionOptions = [
  {
    label: t('extensionsBuiltin.liveCommentary.injectionPositions.beforeLastUserMessage'),
    value: 'before_last_user_message',
  },
  { label: t('extensionsBuiltin.liveCommentary.injectionPositions.endOfContext'), value: 'end_of_context' },
];

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;
</script>

<template>
  <div class="commentary-settings">
    <div v-if="showNote" class="experimental-note">
      <p>
        <b>{{ t('extensionsBuiltin.liveCommentary.experimentalNoteTitle') }}</b>
        {{ t('extensionsBuiltin.liveCommentary.experimentalNote') }}
      </p>
      <button
        class="close-note-btn"
        :title="t('extensionsBuiltin.liveCommentary.dismissNote')"
        @click="showNote = false"
      >
        ×
      </button>
    </div>

    <div class="group-header">{{ t('common.general') }}</div>
    <FormItem :label="t('extensionsBuiltin.liveCommentary.enable')">
      <Toggle v-model="settings.enabled" />
    </FormItem>

    <ConnectionProfileField
      v-model="settings.connectionProfile"
      :label="t('extensionsBuiltin.liveCommentary.connectionProfile')"
      :description="t('extensionsBuiltin.liveCommentary.connectionProfileHint')"
    />

    <div class="setting-row">
      <FormItem :label="t('extensionsBuiltin.liveCommentary.debounceMs')" style="flex: 1">
        <Input v-model.number="settings.debounceMs" type="number" :min="100" :step="100" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.liveCommentary.maxWaitMs')"
        :description="t('extensionsBuiltin.liveCommentary.maxWaitMsHint')"
        style="flex: 1"
      >
        <Input v-model.number="settings.maxWaitMs" type="number" :min="1000" :step="500" />
      </FormItem>
    </div>
    <div class="setting-row">
      <FormItem
        :label="t('extensionsBuiltin.liveCommentary.minIntervalMs')"
        :description="t('extensionsBuiltin.liveCommentary.minIntervalMsHint')"
        style="flex: 1"
      >
        <Input v-model.number="settings.minIntervalMs" type="number" :min="1000" :step="500" />
      </FormItem>
      <FormItem :label="t('extensionsBuiltin.liveCommentary.displayDurationMs')" style="flex: 1">
        <Input v-model.number="settings.displayDurationMs" type="number" :min="1000" :step="500" />
      </FormItem>
    </div>

    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="prompt"
      :label="t('extensionsBuiltin.liveCommentary.promptTemplate')"
      :description="t('extensionsBuiltin.liveCommentary.promptHint')"
      identifier="extension.live-commentary.prompt"
      :rows="10"
      @update:active-preset-id="settings.activePromptPresetId = $event"
      @update:prompt-presets="settings.promptPresets = $event"
    />

    <div class="group-header">{{ t('extensionsBuiltin.liveCommentary.contextInjection') }}</div>
    <FormItem
      :label="t('extensionsBuiltin.liveCommentary.enableInjection')"
      :description="t('extensionsBuiltin.liveCommentary.enableInjectionHint')"
    >
      <Toggle v-model="settings.injectionEnabled" />
    </FormItem>

    <template v-if="settings.injectionEnabled">
      <div class="setting-row">
        <FormItem
          :label="t('extensionsBuiltin.liveCommentary.injectionDepth')"
          :description="t('extensionsBuiltin.liveCommentary.injectionDepthHint')"
          style="flex: 1"
        >
          <Input v-model.number="settings.injectionDepth" type="number" :min="1" :max="100" />
        </FormItem>

        <FormItem :label="t('extensionsBuiltin.liveCommentary.injectionPosition')" style="flex: 1">
          <Select v-model="settings.injectionPosition" :options="positionOptions" />
        </FormItem>
      </div>

      <FormItem
        :label="t('extensionsBuiltin.liveCommentary.injectionTemplate')"
        :description="t('extensionsBuiltin.liveCommentary.injectionTemplateHint')"
      >
        <Textarea
          v-model="settings.injectionTemplate"
          class="prompt-area"
          :rows="3"
          identifier="extension.live-commentary.injection"
          :tools="injectionTools"
        />
      </FormItem>
    </template>

    <div class="group-header">{{ t('extensionsBuiltin.liveCommentary.promptContext') }}</div>
    <FormItem
      :label="t('extensionsBuiltin.liveCommentary.commentaryHistory')"
      :description="t('extensionsBuiltin.liveCommentary.commentaryHistoryHint')"
    >
      <Input v-model.number="settings.maxCommentaryHistory" type="number" :min="0" :max="50" />
    </FormItem>

    <div class="group-header">{{ t('extensionsBuiltin.liveCommentary.askChatHistory') }}</div>
    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="askPrompt"
      :label="t('extensionsBuiltin.liveCommentary.askPromptTemplate')"
      :description="t('extensionsBuiltin.liveCommentary.askPromptHint')"
      identifier="extension.live-commentary.ask"
      :rows="10"
      @update:active-preset-id="settings.activePromptPresetId = $event"
      @update:prompt-presets="settings.promptPresets = $event"
    />
  </div>
</template>

<style scoped>
.commentary-settings {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
}

.setting-row {
  display: flex;
  gap: var(--spacing-md);
}

.prompt-area {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.group-header {
  font-weight: bold;
  font-size: 1.1em;
  color: var(--theme-text-color-primary);
  border-bottom: 1px solid var(--theme-border-color);
  padding-bottom: var(--spacing-xs);
  margin-top: var(--spacing-md);
}

.experimental-note {
  position: relative;
  background-color: var(--black-30a);
  border: 1px solid var(--color-info-cobalt);
  color: var(--theme-text-color);
  padding: var(--spacing-md);
  border-radius: var(--base-border-radius);
}

.experimental-note p {
  margin: 0;
  padding-right: 28px; /* Space for close button */
  line-height: 1.4;
  font-size: 0.95em;
}

.experimental-note b {
  color: var(--color-info-cobalt);
}

.close-note-btn {
  position: absolute;
  top: 50%;
  right: var(--spacing-xs);
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  color: var(--theme-text-color);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
  opacity: 0.6;
  padding: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--animation-duration-sm) ease;
}

.close-note-btn:hover {
  opacity: 1;
  background-color: var(--black-50a);
  transform: translateY(-50%) scale(1.1);
}
</style>
