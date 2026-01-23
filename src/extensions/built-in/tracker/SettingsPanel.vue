<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector, PresetControl } from '../../../components/common';
import { Button, FormItem, Input, Select, Textarea, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
import {
  DEFAULT_PRESETS,
  DEFAULT_SETTINGS,
  type TrackerChatExtra,
  type TrackerMessageExtra,
  type TrackerSchemaPreset,
  type TrackerSettings,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<TrackerSettings, TrackerChatExtra, TrackerMessageExtra>;
}>();

const t = props.api.i18n.t;

// TODO: i18n

const settings = ref<TrackerSettings>({ ...DEFAULT_SETTINGS });
const schemaError = ref<string | null>(null);

onMounted(() => {
  const saved = props.api.settings.get();
  if (saved) {
    // Ensure presets array exists and has content if saved settings are old/malformed
    const presets = saved.schemaPresets && saved.schemaPresets.length > 0 ? saved.schemaPresets : DEFAULT_PRESETS;
    settings.value = { ...DEFAULT_SETTINGS, ...saved, schemaPresets: presets };
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

const activePreset = computed(() => {
  return settings.value.schemaPresets.find((p) => p.name === settings.value.activeSchemaPresetName);
});

watch(
  () => activePreset.value?.schema,
  (newSchema) => {
    if (!newSchema) {
      schemaError.value = null;
      return;
    }
    try {
      JSON.parse(newSchema);
      schemaError.value = null;
    } catch (e) {
      if (e instanceof Error) {
        schemaError.value = e.message;
      } else {
        schemaError.value = 'Invalid JSON format.';
      }
    }
  },
  { immediate: true },
);

const presetOptions = computed(() => {
  return settings.value.schemaPresets.map((p) => ({ label: p.name, value: p.name }));
});

async function handlePresetCreate() {
  const { result, value } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.tracker.popups.createPresetTitle'),
    type: POPUP_TYPE.INPUT,
    inputValue: t('extensionsBuiltin.tracker.popups.newPresetName'),
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && value) {
    if (settings.value.schemaPresets.some((p) => p.name === value)) {
      props.api.ui.showToast(t('extensionsBuiltin.tracker.toasts.presetExistsError'), 'error');
      return;
    }
    const newPreset: TrackerSchemaPreset = activePreset.value
      ? JSON.parse(JSON.stringify(activePreset.value)) // Deep copy current
      : JSON.parse(JSON.stringify(DEFAULT_PRESETS[0])); // Or copy default

    newPreset.name = value;
    settings.value.schemaPresets.push(newPreset);
    settings.value.activeSchemaPresetName = value;
    props.api.ui.showToast(t('extensionsBuiltin.tracker.toasts.presetCreated'), 'success');
  }
}

async function handlePresetEdit() {
  if (!activePreset.value) return;
  const oldName = activePreset.value.name;

  const { result, value } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.tracker.popups.renamePresetTitle'),
    type: POPUP_TYPE.INPUT,
    inputValue: oldName,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && value && value !== oldName) {
    if (settings.value.schemaPresets.some((p) => p.name === value)) {
      props.api.ui.showToast(t('extensionsBuiltin.tracker.toasts.presetExistsError'), 'error');
      return;
    }
    const preset = settings.value.schemaPresets.find((p) => p.name === oldName);
    if (preset) {
      preset.name = value;
      settings.value.activeSchemaPresetName = value;
      props.api.ui.showToast(t('extensionsBuiltin.tracker.toasts.presetRenamed'), 'success');
    }
  }
}

async function handlePresetDelete() {
  if (!activePreset.value || settings.value.schemaPresets.length <= 1) {
    props.api.ui.showToast(t('extensionsBuiltin.tracker.toasts.cannotDeleteLastPreset'), 'warning');
    return;
  }
  const nameToDelete = activePreset.value.name;

  const { result } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.tracker.popups.deletePresetTitle'),
    content: t('extensionsBuiltin.tracker.popups.deletePresetContent', { name: nameToDelete }),
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.delete',
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    const index = settings.value.schemaPresets.findIndex((p) => p.name === nameToDelete);
    if (index > -1) {
      settings.value.schemaPresets.splice(index, 1);
      // Select the previous or first preset
      const newIndex = Math.max(0, index - 1);
      settings.value.activeSchemaPresetName = settings.value.schemaPresets[newIndex].name;
      props.api.ui.showToast(t('extensionsBuiltin.tracker.toasts.presetDeleted'), 'success');
    }
  }
}

async function handleResetAll() {
  const { result } = await props.api.ui.showPopup({
    title: 'Reset All Tracker Presets?',
    content: 'This will reset all schema presets to their default values. This action cannot be undone.',
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.reset',
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    settings.value.schemaPresets = JSON.parse(JSON.stringify(DEFAULT_PRESETS));
    settings.value.activeSchemaPresetName = DEFAULT_PRESETS[0].name;
    props.api.ui.showToast('Tracker presets have been reset.', 'success');
  }
}

const autoModeOptions = [
  { label: 'None', value: 'none' },
  { label: 'AI Responses', value: 'responses' },
  { label: 'User Inputs', value: 'inputs' },
  { label: 'Both', value: 'both' },
];

const promptEngineeringOptions = [
  { label: 'Native (Recommended)', value: 'native' },
  { label: 'Force JSON', value: 'json' },
  { label: 'Force XML', value: 'xml' },
];

const defaultActivePreset = computed(() => {
  if (!activePreset.value) return null;
  return DEFAULT_PRESETS.find((p) => p.name === activePreset.value?.name) ?? null;
});

const schemaTools = computed(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    disabled: !defaultActivePreset.value,
    onClick: async ({ setValue }: { setValue: (v: string) => void }) => {
      if (!defaultActivePreset.value) return;
      const { result } = await props.api.ui.showPopup({
        title: 'Reset Schema?',
        content: `Are you sure you want to reset the schema for "${activePreset.value?.name}" to its default value?`,
        type: POPUP_TYPE.CONFIRM,
        okButton: 'common.reset',
      });
      if (result === POPUP_RESULT.AFFIRMATIVE) {
        setValue(defaultActivePreset.value.schema);
        props.api.ui.showToast('Schema has been reset.', 'success');
      }
    },
  },
]);

const templateTools = computed(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    disabled: !defaultActivePreset.value,
    onClick: async ({ setValue }: { setValue: (v: string) => void }) => {
      if (!defaultActivePreset.value) return;
      const { result } = await props.api.ui.showPopup({
        title: 'Reset Template?',
        content: `Are you sure you want to reset the HTML template for "${activePreset.value?.name}" to its default value?`,
        type: POPUP_TYPE.CONFIRM,
        okButton: 'common.reset',
      });
      if (result === POPUP_RESULT.AFFIRMATIVE) {
        setValue(defaultActivePreset.value.template);
        props.api.ui.showToast('HTML template has been reset.', 'success');
      }
    },
  },
]);

const promptTools = computed(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    disabled: !defaultActivePreset.value,
    onClick: async ({ setValue }: { setValue: (v: string) => void }) => {
      if (!defaultActivePreset.value) return;
      const { result } = await props.api.ui.showPopup({
        title: 'Reset Prompt?',
        content: `Are you sure you want to reset the prompt template for "${activePreset.value?.name}" to its default value?`,
        type: POPUP_TYPE.CONFIRM,
        okButton: 'common.reset',
      });
      if (result === POPUP_RESULT.AFFIRMATIVE) {
        setValue(defaultActivePreset.value.prompt);
        props.api.ui.showToast('Prompt template has been reset.', 'success');
      }
    },
  },
]);
</script>

<template>
  <div class="tracker-settings">
    <div class="group-header">General</div>
    <FormItem label="Enable Tracker">
      <Toggle v-model="settings.enabled" />
    </FormItem>

    <FormItem label="Connection Profile" description="Overrides the chat's connection profile for tracker generation.">
      <ConnectionProfileSelector v-model="settings.connectionProfile" />
    </FormItem>

    <div class="setting-row">
      <FormItem label="Auto Mode" description="Automatically run tracker on new messages." style="flex: 1">
        <Select v-model="settings.autoMode" :options="autoModeOptions" />
      </FormItem>
      <FormItem
        label="Prompt Engineering"
        description="Method to ensure structured output. 'Native' is best if the model supports it."
        style="flex: 1"
      >
        <Select v-model="settings.promptEngineering" :options="promptEngineeringOptions" />
      </FormItem>
    </div>
    <div class="reset-all-container">
      <Button icon="fa-rotate-left" variant="danger" @click="handleResetAll">Reset All Presets</Button>
    </div>

    <div class="group-header">Schema Presets</div>
    <PresetControl
      v-model="settings.activeSchemaPresetName"
      :options="presetOptions"
      allow-create
      allow-edit
      allow-delete
      @create="handlePresetCreate"
      @edit="handlePresetEdit"
      @delete="handlePresetDelete"
    />

    <template v-if="activePreset">
      <FormItem
        label="JSON Schema"
        description="Defines the structure of the data to extract."
        class="schema-form-item"
        :error="schemaError ?? undefined"
      >
        <Textarea
          v-model="activePreset.schema"
          allow-maximize
          class="mono-area"
          :rows="10"
          :identifier="`extension.tracker.schema.${activePreset.name}`"
          :tools="schemaTools"
        />
      </FormItem>
      <FormItem label="HTML Template" description="Handlebars template to render the extracted data in the chat.">
        <Textarea
          v-model="activePreset.template"
          allow-maximize
          class="mono-area"
          :rows="6"
          :identifier="`extension.tracker.template.${activePreset.name}`"
          :tools="templateTools"
        />
      </FormItem>
      <FormItem label="Prompt Template" description="The prompt sent to the AI for data extraction.">
        <Textarea
          v-model="activePreset.prompt"
          allow-maximize
          class="mono-area"
          :rows="6"
          :identifier="`extension.tracker.prompt.${activePreset.name}`"
          :tools="promptTools"
        />
      </FormItem>
    </template>

    <div class="group-header">Context Management</div>
    <div class="setting-row">
      <FormItem label="Max Response Tokens" description="Max tokens for the tracker's response." style="flex: 1">
        <Input v-model.number="settings.maxResponseTokens" type="number" :min="16" :step="16" />
      </FormItem>
      <FormItem
        label="Last Messages"
        description="Include last X messages in prompt context (-1 for all)."
        style="flex: 1"
      >
        <Input v-model.number="settings.includeLastXMessages" type="number" :min="-1" />
      </FormItem>
      <FormItem
        label="Last Trackers"
        description="Include last X trackers in prompt context (-1 for all)."
        style="flex: 1"
      >
        <Input v-model.number="settings.includeLastXTrackers" type="number" :min="-1" />
      </FormItem>
    </div>
    <div class="group-header">Advanced</div>
    <div class="setting-row">
      <FormItem
        label="Parallel Request Limit"
        description="How many trackers can run at the same time."
        style="flex: 1; max-width: 200px"
      >
        <Input v-model.number="settings.parallelRequestLimit" type="number" :min="1" :max="10" />
      </FormItem>
    </div>
  </div>
</template>

<style scoped>
.tracker-settings {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
}
.setting-row {
  display: flex;
  gap: var(--spacing-md);
}
.group-header {
  font-weight: bold;
  font-size: 1.1em;
  color: var(--theme-text-color-primary);
  border-bottom: 1px solid var(--theme-border-color);
  padding-bottom: var(--spacing-xs);
  margin-top: var(--spacing-md);
}
.mono-area {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}
.schema-form-item :deep(.form-item-error) {
  white-space: pre-wrap;
  font-family: var(--font-family-mono);
  font-size: 0.85em;
  max-height: 100px;
  overflow-y: auto;
}
.reset-all-container {
  display: flex;
  justify-content: flex-end;
}
</style>
