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
  type PhoneExtensionAPI,
  type PhoneSettings,
  migratePhoneSettings,
} from './types';

const props = defineProps<{
  api: PhoneExtensionAPI;
}>();

const t = props.api.i18n.t;
const settings = useExtensionSettings<PhoneSettings>(props.api, { ...DEFAULT_SETTINGS }, migratePhoneSettings);

const formatOptions = createStructuredRequestFormatOptions({
  native: t('extensionsBuiltin.phone.requestFormats.native'),
  json: t('extensionsBuiltin.phone.requestFormats.json'),
  xml: t('extensionsBuiltin.phone.requestFormats.xml'),
});

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;
</script>

<template>
  <div class="phone-settings">
    <div class="phone-settings__group">{{ t('common.general') }}</div>
    <FormItem :label="t('extensionsBuiltin.phone.enable')">
      <Toggle v-model="settings.enabled" />
    </FormItem>
    <ConnectionProfileField
      v-model="settings.connectionProfile"
      :label="t('extensionsBuiltin.phone.connectionProfile')"
      :description="t('extensionsBuiltin.phone.connectionProfileHint')"
    />
    <FormItem :label="t('extensionsBuiltin.phone.structuredRequestFormat')">
      <Select v-model="settings.structuredRequestFormat" :options="formatOptions" />
    </FormItem>

    <div class="phone-settings__group">{{ t('extensionsBuiltin.phone.limits') }}</div>
    <NumberSettingField
      v-model="settings.includeLastXMessages"
      :label="t('extensionsBuiltin.phone.recentChatMessages')"
      :description="t('extensionsBuiltin.phone.recentChatMessagesHint')"
      :min="-1"
      :max="500"
    />
    <NumberSettingField
      v-model="settings.includeLastXSmsMessages"
      :label="t('extensionsBuiltin.phone.recentSmsMessages')"
      :description="t('extensionsBuiltin.phone.recentSmsMessagesHint')"
      :min="-1"
      :max="200"
    />
    <NumberSettingField
      v-model="settings.maxResponseTokens"
      :label="t('extensionsBuiltin.phone.maxResponseTokens')"
      :min="512"
      :max="32000"
    />

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
