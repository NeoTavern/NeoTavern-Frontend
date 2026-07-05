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

const t = props.api.i18n.t;
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
  { label: t('extensionsBuiltin.phone.requestFormats.native'), value: 'native' },
  { label: t('extensionsBuiltin.phone.requestFormats.json'), value: 'json' },
  { label: t('extensionsBuiltin.phone.requestFormats.xml'), value: 'xml' },
];

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;
</script>

<template>
  <div class="phone-settings">
    <div class="phone-settings__group">{{ t('common.general') }}</div>
    <FormItem :label="t('extensionsBuiltin.phone.enable')">
      <Toggle v-model="settings.enabled" />
    </FormItem>
    <FormItem
      :label="t('extensionsBuiltin.phone.connectionProfile')"
      :description="t('extensionsBuiltin.phone.connectionProfileHint')"
    >
      <ConnectionProfileSelector v-model="settings.connectionProfile" />
    </FormItem>
    <FormItem :label="t('extensionsBuiltin.phone.structuredRequestFormat')">
      <Select v-model="settings.structuredRequestFormat" :options="formatOptions" />
    </FormItem>

    <div class="phone-settings__group">{{ t('extensionsBuiltin.phone.limits') }}</div>
    <FormItem
      :label="t('extensionsBuiltin.phone.recentChatMessages')"
      :description="t('extensionsBuiltin.phone.recentChatMessagesHint')"
    >
      <Input v-model.number="settings.includeLastXMessages" type="number" :min="-1" :max="500" />
    </FormItem>
    <FormItem
      :label="t('extensionsBuiltin.phone.recentSmsMessages')"
      :description="t('extensionsBuiltin.phone.recentSmsMessagesHint')"
    >
      <Input v-model.number="settings.includeLastXSmsMessages" type="number" :min="-1" :max="200" />
    </FormItem>
    <FormItem :label="t('extensionsBuiltin.phone.maxResponseTokens')">
      <Input v-model.number="settings.maxResponseTokens" type="number" :min="512" :max="32000" />
    </FormItem>

    <div class="phone-settings__group">{{ t('extensionsBuiltin.phone.aiPrompts') }}</div>
    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="contactPrompt"
      :label="t('extensionsBuiltin.phone.contactPrompt')"
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
      :label="t('extensionsBuiltin.phone.smsPrompt')"
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
