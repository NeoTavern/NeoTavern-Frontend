<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Select, Textarea, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import type { TextareaToolDefinition } from '../../../types/ExtensionAPI';
import { DEFAULT_INJECTION_TEMPLATE, DEFAULT_PROMPT, DEFAULT_SETTINGS, type LiveCommentarySettings } from './types';

const props = defineProps<{
  api: ExtensionAPI;
}>();

const t = props.api.i18n.t;

// TODO: i18n
const showNote = ref(true);

const settings = ref<LiveCommentarySettings>({
  ...DEFAULT_SETTINGS,
});

onMounted(() => {
  const saved = props.api.settings.get();
  if (saved) {
    settings.value = { ...DEFAULT_SETTINGS, ...saved };
  }
});

watch(
  settings,
  (newSettings) => {
    props.api.settings.set(undefined, newSettings);
    props.api.settings.save();
  },
  { deep: true },
);

const promptTools = computed<TextareaToolDefinition[]>(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    onClick: ({ setValue }) => {
      setValue(DEFAULT_PROMPT);
    },
  },
]);

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
  { label: 'Before Last User Message', value: 'before_last_user_message' },
  { label: 'End of Context (System)', value: 'end_of_context' },
];
</script>

<template>
  <div class="commentary-settings">
    <div v-if="showNote" class="experimental-note">
      <p>
        <b>Note:</b> This is an experimental extension created to test new concepts. Its future is uncertain, and it may
        be changed or removed. Feedback is welcome!
      </p>
      <button class="close-note-btn" title="Dismiss note" @click="showNote = false">×</button>
    </div>

    <div class="group-header">General</div>
    <FormItem :label="t('extensionsBuiltin.liveCommentary.enable')">
      <Toggle v-model="settings.enabled" />
    </FormItem>

    <FormItem
      :label="t('extensionsBuiltin.liveCommentary.connectionProfile')"
      :description="t('extensionsBuiltin.liveCommentary.connectionProfileHint')"
    >
      <ConnectionProfileSelector v-model="settings.connectionProfile" />
    </FormItem>

    <div class="setting-row">
      <FormItem :label="t('extensionsBuiltin.liveCommentary.debounceMs')" style="flex: 1">
        <Input v-model.number="settings.debounceMs" type="number" :min="100" :step="100" />
      </FormItem>
      <FormItem
        label="Max Wait (ms)"
        description="Triggers commentary if typing this long without pausing."
        style="flex: 1"
      >
        <Input v-model.number="settings.maxWaitMs" type="number" :min="1000" :step="500" />
      </FormItem>
    </div>
    <div class="setting-row">
      <FormItem label="Min Interval (ms)" description="Cooldown per character between commentaries." style="flex: 1">
        <Input v-model.number="settings.minIntervalMs" type="number" :min="1000" :step="500" />
      </FormItem>
      <FormItem :label="t('extensionsBuiltin.liveCommentary.displayDurationMs')" style="flex: 1">
        <Input v-model.number="settings.displayDurationMs" type="number" :min="1000" :step="500" />
      </FormItem>
    </div>

    <FormItem
      :label="t('extensionsBuiltin.liveCommentary.promptTemplate')"
      :description="t('extensionsBuiltin.liveCommentary.promptHint')"
    >
      <Textarea
        v-model="settings.prompt"
        allow-maximize
        class="prompt-area"
        :rows="10"
        identifier="extension.live-commentary.prompt"
        :tools="promptTools"
      />
    </FormItem>

    <div class="group-header">Context Injection</div>
    <FormItem
      label="Enable Injection"
      description="Injects the generated thoughts into the prompt for the AI response."
    >
      <Toggle v-model="settings.injectionEnabled" />
    </FormItem>

    <template v-if="settings.injectionEnabled">
      <div class="setting-row">
        <FormItem label="Injection Depth" description="Number of recent thoughts to inject." style="flex: 1">
          <Input v-model.number="settings.injectionDepth" type="number" :min="1" :max="100" />
        </FormItem>

        <FormItem label="Injection Position" style="flex: 1">
          <Select v-model="settings.injectionPosition" :options="positionOptions" />
        </FormItem>
      </div>

      <FormItem
        label="Injection Template"
        description="Template for the injected thought. Variables: {{char}}, {{thought}}"
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

    <div class="group-header">Prompt Context</div>
    <FormItem
      label="Commentary History"
      description="Max number of recent commentaries to include in the prompt context."
    >
      <Input v-model.number="settings.maxCommentaryHistory" type="number" :min="0" :max="50" />
    </FormItem>
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
