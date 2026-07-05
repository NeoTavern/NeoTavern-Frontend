<script setup lang="ts">
import { computed } from 'vue';
import { PresetControl } from '../../../../components/common';
import { FormItem, Textarea } from '../../../../components/UI';
import { POPUP_RESULT, POPUP_TYPE, type ExtensionAPI } from '../../../../types';
import {
  duplicatePromptPreset,
  getAllPromptPresets,
  getPromptPresetOptions,
  resolvePromptPreset,
  type PromptPreset,
} from '../prompt-presets';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPromptPreset = PromptPreset<any>;

const props = withDefaults(
  defineProps<{
    api: Pick<ExtensionAPI, 'ui'>;
    activePresetId?: string;
    promptPresets?: AnyPromptPreset[];
    builtInPresets: AnyPromptPreset[];
    promptKey: string;
    label: string;
    description?: string;
    identifier: string;
    rows?: number;
  }>(),
  {
    activePresetId: undefined,
    promptPresets: () => [],
    description: undefined,
    rows: 8,
  },
);

const emit = defineEmits<{
  'update:activePresetId': [value: string];
  'update:promptPresets': [value: AnyPromptPreset[]];
}>();

const activePreset = computed(() =>
  resolvePromptPreset(
    {
      activePromptPresetId: props.activePresetId,
      promptPresets: props.promptPresets,
    },
    props.builtInPresets,
  ),
);

const isActiveBuiltIn = computed(() => !!activePreset.value.builtIn);

const presetOptions = computed(() => getPromptPresetOptions(props.builtInPresets, props.promptPresets));

const promptValue = computed({
  get: () => activePreset.value.prompts[props.promptKey] ?? '',
  set: (value) => {
    if (isActiveBuiltIn.value) return;
    emit(
      'update:promptPresets',
      props.promptPresets.map((preset) =>
        preset.id === activePreset.value.id
          ? { ...preset, prompts: { ...preset.prompts, [props.promptKey]: value } }
          : preset,
      ),
    );
  },
});

async function createPreset() {
  const { result, value } = await props.api.ui.showPopup({
    type: POPUP_TYPE.INPUT,
    title: 'Create prompt preset',
    content: 'Enter a name for the new prompt preset:',
    inputValue: 'Custom',
    inputRequired: true,
    okButton: 'common.create',
    cancelButton: 'common.cancel',
  });

  if (result !== POPUP_RESULT.AFFIRMATIVE || typeof value !== 'string' || !value.trim()) return;

  const allPresets = getAllPromptPresets(props.builtInPresets, props.promptPresets);
  const newPreset = duplicatePromptPreset(activePreset.value, allPresets, value.trim());
  emit('update:promptPresets', [...props.promptPresets, newPreset]);
  emit('update:activePresetId', newPreset.id);
}

async function deletePreset() {
  if (isActiveBuiltIn.value) return;

  const { result } = await props.api.ui.showPopup({
    type: POPUP_TYPE.CONFIRM,
    title: 'Delete prompt preset',
    content: `Delete prompt preset "${activePreset.value.name}"?`,
    okButton: 'common.delete',
    cancelButton: 'common.cancel',
  });

  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  emit(
    'update:promptPresets',
    props.promptPresets.filter((preset) => preset.id !== activePreset.value.id),
  );
  emit('update:activePresetId', props.builtInPresets[0].id);
}

async function renamePreset() {
  if (isActiveBuiltIn.value) return;

  const { result, value } = await props.api.ui.showPopup({
    type: POPUP_TYPE.INPUT,
    title: 'Rename prompt preset',
    content: 'Enter a new name for this prompt preset:',
    inputValue: activePreset.value.name,
    inputRequired: true,
    okButton: 'common.rename',
    cancelButton: 'common.cancel',
  });

  if (result !== POPUP_RESULT.AFFIRMATIVE || typeof value !== 'string') return;

  const name = value.trim();
  if (!name || name === activePreset.value.name) return;

  const allPresets = getAllPromptPresets(props.builtInPresets, props.promptPresets);
  if (allPresets.some((preset) => preset.id !== activePreset.value.id && preset.name === name)) {
    props.api.ui.showToast('A prompt preset with that name already exists.', 'error');
    return;
  }

  emit(
    'update:promptPresets',
    props.promptPresets.map((preset) => (preset.id === activePreset.value.id ? { ...preset, name } : preset)),
  );
}
</script>

<template>
  <FormItem :label="label" :description="description">
    <PresetControl
      :model-value="activePreset.id"
      :options="presetOptions"
      allow-create
      :allow-edit="!isActiveBuiltIn"
      :allow-delete="!isActiveBuiltIn"
      @update:model-value="emit('update:activePresetId', String($event))"
      @create="createPreset"
      @edit="renamePreset"
      @delete="deletePreset"
    />
    <Textarea
      v-model="promptValue"
      allow-maximize
      class="prompt-area"
      :rows="rows"
      :identifier="identifier"
      :disabled="isActiveBuiltIn"
    />
  </FormItem>
</template>

<style scoped>
.prompt-area {
  margin-top: 8px;
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}
</style>
