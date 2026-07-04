<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Select, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import PromptPresetField from '../PromptPresetField.vue';
import {
  BUILT_IN_PROMPT_PRESETS,
  DEFAULT_SETTINGS,
  type RoadwayChatExtra,
  type RoadwayMessageExtra,
  type RoadwaySettings,
  migrateRoadwaySettings,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<RoadwaySettings, RoadwayChatExtra, RoadwayMessageExtra>;
}>();

// TODO: i18n

const settings = ref<RoadwaySettings>({ ...DEFAULT_SETTINGS });

onMounted(() => {
  settings.value = migrateRoadwaySettings(props.api.settings.get());
});

watch(
  settings,
  (newSettings) => {
    props.api.settings.set(undefined, newSettings);
    // @ts-expect-error custom event
    props.api.events.emit('roadway:settings-changed');
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
    <FormItem label="Request Format" description="Format to enforce for the structured response.">
      <Select v-model="settings.structuredRequestFormat" :options="formatOptions" />
    </FormItem>
    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="choiceGenPrompt"
      label="Prompt Template"
      description="The prompt sent to the AI to generate choices. Use {{choiceCount}} to reference the number of choices."
      identifier="extension.roadway.choiceGenPrompt"
      :rows="6"
      @update:active-preset-id="settings.activePromptPresetId = $event"
      @update:prompt-presets="settings.promptPresets = $event"
    />

    <div class="group-header">Impersonate Action</div>
    <FormItem
      label="Connection Profile"
      description="Overrides the chat's connection profile for the 'Impersonate' action."
    >
      <ConnectionProfileSelector v-model="settings.impersonateConnectionProfile" />
    </FormItem>
    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="impersonatePrompt"
      label="Prompt Template"
      description="The prompt sent to the AI to expand a choice into a full user response."
      identifier="extension.roadway.impersonatePrompt"
      :rows="6"
      @update:active-preset-id="settings.activePromptPresetId = $event"
      @update:prompt-presets="settings.promptPresets = $event"
    />
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
