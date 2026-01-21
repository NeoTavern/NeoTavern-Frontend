<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Textarea, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
import {
  DEFAULT_CHOICE_GEN_PROMPT,
  DEFAULT_IMPERSONATE_PROMPT,
  DEFAULT_SETTINGS,
  type RoadwayChatExtra,
  type RoadwayMessageExtra,
  type RoadwaySettings,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<RoadwaySettings, RoadwayChatExtra, RoadwayMessageExtra>;
}>();

const t = props.api.i18n.t;

// TODO: i18n

const settings = ref<RoadwaySettings>({ ...DEFAULT_SETTINGS });

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

const createResetTool = (title: string, content: string, defaultValue: string, successMessage: string) =>
  computed(() => [
    {
      id: 'reset',
      icon: 'fa-rotate-left',
      title: t('common.reset'),
      onClick: async ({ setValue }: { setValue: (v: string) => void }) => {
        const { result } = await props.api.ui.showPopup({
          title,
          content,
          type: POPUP_TYPE.CONFIRM,
          okButton: 'common.reset',
        });
        if (result === POPUP_RESULT.AFFIRMATIVE) {
          setValue(defaultValue);
          props.api.ui.showToast(successMessage, 'success');
        }
      },
    },
  ]);

const choiceGenPromptTools = createResetTool(
  'Reset Choice Generation Prompt?',
  'Are you sure you want to reset the choice generation prompt to its default value?',
  DEFAULT_CHOICE_GEN_PROMPT,
  'Choice generation prompt has been reset.',
);

const impersonatePromptTools = createResetTool(
  'Reset Impersonate Prompt?',
  'Are you sure you want to reset the impersonate prompt to its default value?',
  DEFAULT_IMPERSONATE_PROMPT,
  'Impersonate prompt has been reset.',
);
</script>

<template>
  <div class="roadway-settings">
    <div class="group-header">General</div>
    <FormItem label="Enable Roadway Extension">
      <Toggle v-model="settings.enabled" />
    </FormItem>
    <FormItem
      label="Auto-generate Choices"
      description="Automatically generate choices after every AI response when Roadway is active in a chat."
    >
      <Toggle v-model="settings.autoMode" />
    </FormItem>

    <div class="group-header">Choice Generation</div>
    <FormItem label="Connection Profile" description="Overrides the chat's connection profile for generating choices.">
      <ConnectionProfileSelector v-model="settings.choiceGenConnectionProfile" />
    </FormItem>
    <FormItem label="Number of Choices" description="How many choices to generate for each message.">
      <Input v-model.number="settings.choiceCount" type="number" :min="1" :max="20" />
    </FormItem>
    <FormItem
      label="Prompt Template"
      description="The prompt sent to the AI to generate choices. Use {{choiceCount}} to reference the number of choices."
    >
      <Textarea
        v-model="settings.choiceGenPrompt"
        allow-maximize
        :rows="6"
        identifier="extension.roadway.choiceGenPrompt"
        :tools="choiceGenPromptTools"
      />
    </FormItem>

    <div class="group-header">Impersonate Action</div>
    <FormItem
      label="Connection Profile"
      description="Overrides the chat's connection profile for the 'Impersonate' action."
    >
      <ConnectionProfileSelector v-model="settings.impersonateConnectionProfile" />
    </FormItem>
    <FormItem
      label="Prompt Template"
      description="The prompt sent to the AI to expand a choice into a full user response."
    >
      <Textarea
        v-model="settings.impersonatePrompt"
        allow-maximize
        :rows="6"
        identifier="extension.roadway.impersonatePrompt"
        :tools="impersonatePromptTools"
      />
    </FormItem>
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
