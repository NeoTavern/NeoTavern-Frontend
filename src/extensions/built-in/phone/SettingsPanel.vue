<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Select, Textarea, Toggle } from '../../../components/UI';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
import {
  DEFAULT_CONTACT_PROMPT,
  DEFAULT_SETTINGS,
  DEFAULT_SMS_PROMPT,
  type PhoneExtensionAPI,
  type PhoneSettings,
} from './types';

const props = defineProps<{
  api: PhoneExtensionAPI;
}>();

const settings = ref<PhoneSettings>({ ...DEFAULT_SETTINGS });
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

function resetTool(defaultValue: string, label: string) {
  return [
    {
      id: `reset-${label}`,
      icon: 'fa-rotate-left',
      title: t('common.reset'),
      onClick: async ({ setValue }: { setValue: (value: string) => void }) => {
        const { result } = await props.api.ui.showPopup({
          title: `Reset ${label} Prompt?`,
          content: `Reset the ${label.toLowerCase()} prompt to its default value?`,
          type: POPUP_TYPE.CONFIRM,
          okButton: 'common.reset',
          cancelButton: 'common.cancel',
        });
        if (result === POPUP_RESULT.AFFIRMATIVE) setValue(defaultValue);
      },
    },
  ];
}

const contactPromptTools = computed(() => resetTool(DEFAULT_CONTACT_PROMPT, 'Contact'));
const smsPromptTools = computed(() => resetTool(DEFAULT_SMS_PROMPT, 'SMS'));
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
    <FormItem label="Contact Prompt">
      <Textarea
        v-model="settings.contactPrompt"
        allow-maximize
        :rows="10"
        identifier="extension.phone.contactPrompt"
        :tools="contactPromptTools"
      />
    </FormItem>
    <FormItem label="SMS Prompt">
      <Textarea
        v-model="settings.smsPrompt"
        allow-maximize
        :rows="12"
        identifier="extension.phone.smsPrompt"
        :tools="smsPromptTools"
      />
    </FormItem>
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
