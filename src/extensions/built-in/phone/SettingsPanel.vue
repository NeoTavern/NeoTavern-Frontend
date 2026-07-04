<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Select, Toggle } from '../../../components/UI';
import PromptPresetField from '../PromptPresetField.vue';
import {
  BUILT_IN_PROMPT_PRESETS,
  DEFAULT_SETTINGS,
  type PhoneExtensionAPI,
  type PhoneSettings,
  migratePhoneSettings,
} from './types';

const props = defineProps<{
  api: PhoneExtensionAPI;
}>();

const settings = ref<PhoneSettings>({ ...DEFAULT_SETTINGS });

onMounted(() => {
  settings.value = migratePhoneSettings(props.api.settings.get());
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

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;
</script>

<template>
  <div class="phone-settings">
    <div class="phone-settings__group">General</div>
    <FormItem label="Enable Phone">
      <Toggle v-model="settings.enabled" />
    </FormItem>
    <FormItem label="Connection Profile" description="Overrides the chat connection profile for phone generations.">
      <ConnectionProfileSelector v-model="settings.connectionProfile" />
    </FormItem>
    <FormItem label="Structured Request Format">
      <Select v-model="settings.structuredRequestFormat" :options="formatOptions" />
    </FormItem>

    <div class="phone-settings__group">Limits</div>
    <FormItem label="Recent Chat Messages" description="Use -1 to include the full current chat context.">
      <Input v-model.number="settings.includeLastXMessages" type="number" :min="-1" :max="500" />
    </FormItem>
    <FormItem label="Recent SMS Messages" description="Used inside explicit SMS reply prompts.">
      <Input v-model.number="settings.includeLastXSmsMessages" type="number" :min="-1" :max="200" />
    </FormItem>
    <FormItem label="Max Response Tokens">
      <Input v-model.number="settings.maxResponseTokens" type="number" :min="512" :max="32000" />
    </FormItem>

    <div class="phone-settings__group">AI Prompts</div>
    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="contactPrompt"
      label="Contact Prompt"
      identifier="extension.phone.contactPrompt"
      :rows="10"
      @update:active-preset-id="settings.activePromptPresetId = $event"
      @update:prompt-presets="settings.promptPresets = $event"
    />
    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="smsPrompt"
      label="SMS Prompt"
      identifier="extension.phone.smsPrompt"
      :rows="12"
      @update:active-preset-id="settings.activePromptPresetId = $event"
      @update:prompt-presets="settings.promptPresets = $event"
    />
  </div>
</template>

<style scoped>
.phone-settings {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
}

.phone-settings__group {
  padding-bottom: var(--spacing-xs);
  border-bottom: 1px solid var(--theme-border-color);
  color: var(--theme-text-color-primary);
  font-size: 1.05rem;
  font-weight: 700;
}
</style>
