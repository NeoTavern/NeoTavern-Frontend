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
  migrateTrackerSettings,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<TrackerSettings, TrackerChatExtra, TrackerMessageExtra>;
}>();

const t = props.api.i18n.t;

const settings = ref<TrackerSettings>({ ...DEFAULT_SETTINGS });
const schemaError = ref<string | null>(null);

onMounted(() => {
  settings.value = migrateTrackerSettings(props.api.settings.get());
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

const isActivePresetBuiltIn = computed(() => !!activePreset.value?.builtIn);

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
        schemaError.value = t('extensionsBuiltin.tracker.errors.invalidJson');
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
    newPreset.builtIn = false;
    settings.value.schemaPresets.push(newPreset);
    settings.value.activeSchemaPresetName = value;
    props.api.ui.showToast(t('extensionsBuiltin.tracker.toasts.presetCreated'), 'success');
  }
}

async function handlePresetEdit() {
  if (!activePreset.value || activePreset.value.builtIn) return;
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
  if (!activePreset.value || activePreset.value.builtIn || settings.value.schemaPresets.length <= 1) {
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
    title: t('extensionsBuiltin.tracker.popups.resetAllTitle'),
    content: t('extensionsBuiltin.tracker.popups.resetAllContent'),
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.reset',
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    settings.value.schemaPresets = JSON.parse(JSON.stringify(DEFAULT_PRESETS));
    settings.value.activeSchemaPresetName = DEFAULT_PRESETS[0].name;
    props.api.ui.showToast(t('extensionsBuiltin.tracker.toasts.presetsReset'), 'success');
  }
}

const autoModeOptions = [
  { label: t('common.none'), value: 'none' },
  { label: t('extensionsBuiltin.tracker.autoModes.responses'), value: 'responses' },
  { label: t('extensionsBuiltin.tracker.autoModes.inputs'), value: 'inputs' },
  { label: t('extensionsBuiltin.tracker.autoModes.both'), value: 'both' },
];

const promptEngineeringOptions = [
  { label: t('extensionsBuiltin.tracker.promptEngineering.native'), value: 'native' },
  { label: t('extensionsBuiltin.tracker.promptEngineering.json'), value: 'json' },
  { label: t('extensionsBuiltin.tracker.promptEngineering.xml'), value: 'xml' },
];

const deltaModeOptions = [
  { label: t('extensionsBuiltin.tracker.deltaModes.auto'), value: 'auto' },
  { label: t('extensionsBuiltin.tracker.deltaModes.off'), value: 'off' },
  { label: t('extensionsBuiltin.tracker.deltaModes.always'), value: 'always' },
];

const schemaTools = computed(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    disabled: true,
    onClick: async ({ setValue }: { setValue: (v: string) => void }) => {
      const defaultActivePreset = DEFAULT_PRESETS.find((p) => p.name === activePreset.value?.name) ?? null;
      if (!defaultActivePreset) return;
      const { result } = await props.api.ui.showPopup({
        title: t('extensionsBuiltin.tracker.popups.resetSchemaTitle'),
        content: t('extensionsBuiltin.tracker.popups.resetSchemaContent', { name: activePreset.value?.name ?? '' }),
        type: POPUP_TYPE.CONFIRM,
        okButton: 'common.reset',
      });
      if (result === POPUP_RESULT.AFFIRMATIVE) {
        setValue(defaultActivePreset.schema);
        props.api.ui.showToast(t('extensionsBuiltin.tracker.toasts.schemaReset'), 'success');
      }
    },
  },
]);

const templateTools = computed(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    disabled: true,
    onClick: async ({ setValue }: { setValue: (v: string) => void }) => {
      const defaultActivePreset = DEFAULT_PRESETS.find((p) => p.name === activePreset.value?.name) ?? null;
      if (!defaultActivePreset) return;
      const { result } = await props.api.ui.showPopup({
        title: t('extensionsBuiltin.tracker.popups.resetTemplateTitle'),
        content: t('extensionsBuiltin.tracker.popups.resetTemplateContent', { name: activePreset.value?.name ?? '' }),
        type: POPUP_TYPE.CONFIRM,
        okButton: 'common.reset',
      });
      if (result === POPUP_RESULT.AFFIRMATIVE) {
        setValue(defaultActivePreset.template);
        props.api.ui.showToast(t('extensionsBuiltin.tracker.toasts.templateReset'), 'success');
      }
    },
  },
]);

const promptTools = computed(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    disabled: true,
    onClick: async ({ setValue }: { setValue: (v: string) => void }) => {
      const defaultActivePreset = DEFAULT_PRESETS.find((p) => p.name === activePreset.value?.name) ?? null;
      if (!defaultActivePreset) return;
      const { result } = await props.api.ui.showPopup({
        title: t('extensionsBuiltin.tracker.popups.resetPromptTitle'),
        content: t('extensionsBuiltin.tracker.popups.resetPromptContent', { name: activePreset.value?.name ?? '' }),
        type: POPUP_TYPE.CONFIRM,
        okButton: 'common.reset',
      });
      if (result === POPUP_RESULT.AFFIRMATIVE) {
        setValue(defaultActivePreset.prompt);
        props.api.ui.showToast(t('extensionsBuiltin.tracker.toasts.promptReset'), 'success');
      }
    },
  },
]);
</script>

<template>
  <div class="tracker-settings">
    <div class="group-header">{{ t('common.general') }}</div>
    <FormItem :label="t('extensionsBuiltin.tracker.settings.enable')">
      <Toggle v-model="settings.enabled" />
    </FormItem>

    <FormItem
      :label="t('extensionsBuiltin.tracker.settings.connectionProfile')"
      :description="t('extensionsBuiltin.tracker.settings.connectionProfileHint')"
    >
      <ConnectionProfileSelector v-model="settings.connectionProfile" />
    </FormItem>

    <div class="setting-row">
      <FormItem
        :label="t('extensionsBuiltin.tracker.settings.autoMode')"
        :description="t('extensionsBuiltin.tracker.settings.autoModeHint')"
        style="flex: 1"
      >
        <Select v-model="settings.autoMode" :options="autoModeOptions" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.tracker.settings.promptEngineering')"
        :description="t('extensionsBuiltin.tracker.settings.promptEngineeringHint')"
        style="flex: 1"
      >
        <Select v-model="settings.promptEngineering" :options="promptEngineeringOptions" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.tracker.settings.deltaMode')"
        :description="t('extensionsBuiltin.tracker.settings.deltaModeHint')"
        style="flex: 1"
      >
        <Select v-model="settings.deltaMode" :options="deltaModeOptions" />
      </FormItem>
    </div>
    <div class="reset-all-container">
      <Button icon="fa-rotate-left" variant="danger" @click="handleResetAll">
        {{ t('extensionsBuiltin.tracker.settings.resetAllPresets') }}
      </Button>
    </div>

    <div class="group-header">{{ t('extensionsBuiltin.tracker.settings.schemaPresets') }}</div>
    <PresetControl
      v-model="settings.activeSchemaPresetName"
      :options="presetOptions"
      allow-create
      :allow-edit="!isActivePresetBuiltIn"
      :allow-delete="!isActivePresetBuiltIn"
      @create="handlePresetCreate"
      @edit="handlePresetEdit"
      @delete="handlePresetDelete"
    />

    <template v-if="activePreset">
      <FormItem
        :label="t('extensionsBuiltin.tracker.settings.jsonSchema')"
        :description="t('extensionsBuiltin.tracker.settings.jsonSchemaHint')"
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
          :disabled="isActivePresetBuiltIn"
        />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.tracker.settings.htmlTemplate')"
        :description="t('extensionsBuiltin.tracker.settings.htmlTemplateHint')"
      >
        <Textarea
          v-model="activePreset.template"
          allow-maximize
          class="mono-area"
          :rows="6"
          :identifier="`extension.tracker.template.${activePreset.name}`"
          :tools="templateTools"
          :disabled="isActivePresetBuiltIn"
        />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.tracker.settings.promptTemplate')"
        :description="t('extensionsBuiltin.tracker.settings.promptTemplateHint')"
      >
        <Textarea
          v-model="activePreset.prompt"
          allow-maximize
          class="mono-area"
          :rows="6"
          :identifier="`extension.tracker.prompt.${activePreset.name}`"
          :tools="promptTools"
          :disabled="isActivePresetBuiltIn"
        />
      </FormItem>
    </template>

    <div class="group-header">{{ t('extensionsBuiltin.tracker.settings.contextManagement') }}</div>
    <div class="setting-row">
      <FormItem
        :label="t('extensionsBuiltin.tracker.settings.maxResponseTokens')"
        :description="t('extensionsBuiltin.tracker.settings.maxResponseTokensHint')"
        style="flex: 1"
      >
        <Input v-model.number="settings.maxResponseTokens" type="number" :min="16" :step="16" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.tracker.settings.lastMessages')"
        :description="t('extensionsBuiltin.tracker.settings.lastMessagesHint')"
        style="flex: 1"
      >
        <Input v-model.number="settings.includeLastXMessages" type="number" :min="-1" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.tracker.settings.lastTrackers')"
        :description="t('extensionsBuiltin.tracker.settings.lastTrackersHint')"
        style="flex: 1"
      >
        <Input v-model.number="settings.includeLastXTrackers" type="number" :min="-1" />
      </FormItem>
    </div>
    <div class="group-header">{{ t('extensionsBuiltin.tracker.settings.advanced') }}</div>
    <div class="setting-row">
      <FormItem
        :label="t('extensionsBuiltin.tracker.settings.parallelRequestLimit')"
        :description="t('extensionsBuiltin.tracker.settings.parallelRequestLimitHint')"
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
