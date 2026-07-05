<script setup lang="ts">
import type { Expression } from 'jsep';
import jsep from 'jsep';
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import type { CustomAction } from '../../../components/common/PresetControl.vue';
import PresetControl from '../../../components/common/PresetControl.vue';
import { FormItem, Input, Select, Toggle } from '../../../components/UI';
import CollapsibleSection from '../../../components/UI/CollapsibleSection.vue';
import Tabs from '../../../components/UI/Tabs.vue';
import Textarea from '../../../components/UI/Textarea.vue';
import { usePopupStore } from '../../../stores/popup.store';
import { POPUP_TYPE } from '../../../types';
import {
  cloneDefaultMythicSettings,
  DEFAULT_EVENT_GENERATION_DATA,
  DEFAULT_FATE_CHART_DATA,
  DEFAULT_UNE_SETTINGS,
  migrateMythicSettings,
} from './defaults';
import { ANALYSIS_PROMPT, INITIAL_SCENE_PROMPT, NARRATION_PROMPT } from './prompts';
import type { EventFocus, FateChartData, MythicExtensionAPI, MythicPreset, MythicSettings } from './types';

const props = defineProps<{
  api: MythicExtensionAPI;
}>();

const t = props.api.i18n.t;
const initial: MythicSettings = cloneDefaultMythicSettings();

const settings = ref<MythicSettings>(JSON.parse(JSON.stringify(initial)));
const popupStore = usePopupStore();
const activeTab = ref('general');
const activePromptTab = ref('initialScene');
const selectedPreset = ref('');
const fileInputRef = ref<HTMLInputElement>();
const importMode = ref<'array' | 'single'>('array');

const currentPreset = computed(() => {
  return settings.value.presets.find((p) => p.name === selectedPreset.value) || settings.value.presets[0];
});

const isCurrentPresetBuiltIn = computed(() => currentPreset.value?.builtIn === true);

function isPresetContentEditable(): boolean {
  if (isCurrentPresetBuiltIn.value) {
    props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.builtInReadOnly'), 'error');
    return false;
  }
  return true;
}

const mainTabs = [
  { label: t('extensionsBuiltin.mythicAgents.tabs.general'), value: 'general' },
  { label: t('extensionsBuiltin.mythicAgents.tabs.prompts'), value: 'prompts' },
  { label: t('extensionsBuiltin.mythicAgents.tabs.fateChart'), value: 'fateChart' },
  { label: t('extensionsBuiltin.mythicAgents.tabs.eventTables'), value: 'eventTables' },
  { label: t('extensionsBuiltin.mythicAgents.tabs.une'), value: 'une' },
];

const promptTypes: { key: keyof NonNullable<MythicSettings['prompts']>; label: string }[] = [
  { key: 'initialScene', label: t('extensionsBuiltin.mythicAgents.prompts.initialScene') },
  { key: 'analysis', label: t('extensionsBuiltin.mythicAgents.prompts.analysis') },
  { key: 'narration', label: t('extensionsBuiltin.mythicAgents.prompts.narration') },
];

const formatOptions = [
  { label: t('extensionsBuiltin.mythicAgents.requestFormats.native'), value: 'native' },
  { label: t('extensionsBuiltin.mythicAgents.requestFormats.json'), value: 'json' },
  { label: t('extensionsBuiltin.mythicAgents.requestFormats.xml'), value: 'xml' },
];

// JSON Editors State
const fateChartJson = ref('');
const eventFocusesJson = ref('');
const eventActionsJson = ref('');
const eventSubjectsJson = ref('');
const modifiersJson = ref('');
const nounsJson = ref('');
const motivationVerbsJson = ref('');
const motivationNounsJson = ref('');
const characterTypesJson = ref('');

function loadJsonFromSettings() {
  fateChartJson.value = JSON.stringify(currentPreset.value.data.fateChart, null, 2);
  eventFocusesJson.value = JSON.stringify(currentPreset.value.data.eventGeneration.focuses, null, 2);
  eventActionsJson.value = currentPreset.value.data.eventGeneration.actions.join('\n');
  eventSubjectsJson.value = currentPreset.value.data.eventGeneration.subjects.join('\n');
  modifiersJson.value = currentPreset.value.data.une.modifiers.join('\n');
  nounsJson.value = currentPreset.value.data.une.nouns.join('\n');
  motivationVerbsJson.value = currentPreset.value.data.une.motivation_verbs.join('\n');
  motivationNounsJson.value = currentPreset.value.data.une.motivation_nouns.join('\n');
  characterTypesJson.value = currentPreset.value.data.characterTypes.join('\n');
}

// Validation Logic

function validateFateChart(data: FateChartData): string[] {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null) {
    return ['Root must be an object.'];
  }

  const presentRanks = Object.keys(data).filter((key) => /^\d+$/.test(key));
  if (presentRanks.length === 0) {
    return ['No valid Chaos Ranks found.'];
  }

  let requiredOdds: string[] | null = null;
  for (const rank of presentRanks) {
    if (data[rank] && typeof data[rank] === 'object' && data[rank] !== null) {
      requiredOdds = Object.keys(data[rank]);
      break;
    }
  }

  if (!requiredOdds) {
    return ['No valid Chaos Ranks found to establish a baseline for odds.'];
  }

  for (const rank of presentRanks) {
    if (typeof data[rank] !== 'object' || data[rank] === null) {
      errors.push(`Chaos Rank "${rank}" must be an object.`);
      continue;
    }

    for (const odds of requiredOdds) {
      if (!data[rank][odds]) {
        errors.push(`Missing Odds "${odds}" in Chaos Rank "${rank}"`);
        continue;
      }
      const entry = data[rank][odds];
      if (typeof entry !== 'object' || entry === null) {
        errors.push(`Entry for "${odds}" in Rank "${rank}" must be an object.`);
        continue;
      }

      if (typeof entry.chance !== 'number')
        errors.push(`"${odds}" in Rank "${rank}" is missing a valid 'chance' number.`);
      if (typeof entry.exceptional_yes !== 'number')
        errors.push(`"${odds}" in Rank "${rank}" is missing a valid 'exceptional_yes' number.`);
      if (typeof entry.exceptional_no !== 'number')
        errors.push(`"${odds}" in Rank "${rank}" is missing a valid 'exceptional_no' number.`);
    }
  }

  return errors;
}

const normalizeTypeToAction = (type: string) => `random_${type.toLowerCase().replace(/\s/g, '_')}`;
const normalizeTypeToNewAction = (type: string) => `new_${type.toLowerCase().replace(/\s/g, '_')}`;

function validateFocuses(focuses: EventFocus[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(focuses)) {
    return ['Focuses must be an array.'];
  }

  const characterTypes = currentPreset.value.data.characterTypes || ['NPC'];
  const validActions = [
    'random_thread',
    'random_npc',
    'new_npc',
    'random_pc',
    'new_pc',
    ...characterTypes.map(normalizeTypeToAction),
    ...characterTypes.map(normalizeTypeToNewAction),
  ];

  const coverage = new Array(100).fill(false);

  for (const focus of focuses) {
    if (typeof focus.min !== 'number' || typeof focus.max !== 'number' || typeof focus.focus !== 'string') {
      errors.push(`Invalid focus entry: ${JSON.stringify(focus)}. Must have min/max numbers and a focus string.`);
      continue;
    }
    if (focus.min > focus.max) {
      errors.push(`min (${focus.min}) cannot be greater than max (${focus.max}) in "${focus.focus}".`);
    }
    if (focus.min < 1 || focus.max > 100) {
      errors.push(`min/max must be between 1 and 100. Found: ${focus.min}-${focus.max}.`);
    }

    if (focus.action !== undefined) {
      if (typeof focus.action !== 'string') {
        errors.push(`Action for focus "${focus.focus}" must be a string.`);
      } else {
        try {
          if (!jsep.binary_ops['or']) jsep.addBinaryOp('or', 1);
          if (!jsep.binary_ops['and']) jsep.addBinaryOp('and', 2);

          const ast = jsep(focus.action);
          const identifiers: string[] = [];

          const collectIdentifiers = (node: Expression) => {
            if (node.type === 'Identifier') {
              identifiers.push((node as jsep.Identifier).name);
            } else if (node.type === 'BinaryExpression') {
              const bin = node as jsep.BinaryExpression;
              collectIdentifiers(bin.left);
              collectIdentifiers(bin.right);
            }
          };
          collectIdentifiers(ast);

          for (const id of identifiers) {
            if (!validActions.includes(id)) {
              errors.push(
                `Invalid action part "${id}" in focus "${focus.focus}". Valid actions are: ${validActions.join(', ')}.`,
              );
            }
          }
        } catch (e: unknown) {
          errors.push(`Invalid action syntax in focus "${focus.focus}": ${(e as Error).message}`);
        }
      }
    }

    for (let i = focus.min; i <= focus.max; i++) {
      if (coverage[i - 1]) {
        errors.push(`Overlap detected: Number ${i} is covered by multiple focus entries.`);
      }
      coverage[i - 1] = true;
    }
  }

  const gaps = coverage.map((covered, index) => (covered ? -1 : index + 1)).filter((num) => num !== -1);
  if (gaps.length > 0) {
    errors.push(
      `Gaps detected. The following numbers are not covered: ${gaps.slice(0, 10).join(', ')}${gaps.length > 10 ? '...' : ''}`,
    );
  }
  return errors;
}

function validateCurrentPreset(): string[] {
  const errors: string[] = [];
  const fateErrors = validateFateChart(currentPreset.value.data.fateChart);
  errors.push(...fateErrors.map((e) => `Fate Chart: ${e}`));
  const focusErrors = validateFocuses(currentPreset.value.data.eventGeneration.focuses);
  errors.push(...focusErrors.map((e) => `Event Focuses: ${e}`));
  return errors;
}

async function saveFateChart() {
  if (!isPresetContentEditable()) return;
  try {
    const data = JSON.parse(fateChartJson.value);
    const errors = validateFateChart(data);
    if (errors.length > 0) {
      await popupStore.show({
        type: POPUP_TYPE.TEXT,
        title: t('extensionsBuiltin.mythicAgents.validationErrors'),
        content: errors.join('\n'),
        okButton: true,
      });
      return;
    }
    currentPreset.value.data.fateChart = data;
    props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.fateChartUpdated'), 'success');
  } catch {
    props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.invalidJson'), 'error');
  }
}

async function resetFateChart() {
  if (!isPresetContentEditable()) return;
  fateChartJson.value = JSON.stringify(DEFAULT_FATE_CHART_DATA, null, 2);
  saveFateChart();
}

async function saveEventFocuses() {
  if (!isPresetContentEditable()) return;
  try {
    const data = JSON.parse(eventFocusesJson.value);
    const errors = validateFocuses(data);
    if (errors.length > 0) {
      await popupStore.show({
        type: POPUP_TYPE.TEXT,
        title: t('extensionsBuiltin.mythicAgents.validationErrors'),
        content: errors.join('\n'),
        okButton: true,
      });
      return;
    }
    currentPreset.value.data.eventGeneration.focuses = data;
    props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.eventFocusesUpdated'), 'success');
  } catch {
    props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.invalidJson'), 'error');
  }
}

function resetEventFocuses() {
  if (!isPresetContentEditable()) return;
  eventFocusesJson.value = JSON.stringify(DEFAULT_EVENT_GENERATION_DATA.focuses, null, 2);
  saveEventFocuses();
}

function saveStringArray(target: 'actions' | 'subjects', jsonValue: string) {
  if (!isPresetContentEditable()) return;
  const data = jsonValue
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  currentPreset.value.data.eventGeneration[target] = data;
  const tableLabels = {
    actions: t('extensionsBuiltin.mythicAgents.eventTables.actions'),
    subjects: t('extensionsBuiltin.mythicAgents.eventTables.subjects'),
  };
  props.api.ui.showToast(
    t('extensionsBuiltin.mythicAgents.toasts.tableUpdated', {
      table: tableLabels[target],
    }),
    'success',
  );
}

function resetStringArray(target: 'actions' | 'subjects') {
  if (!isPresetContentEditable()) return;
  const def = DEFAULT_EVENT_GENERATION_DATA[target];
  if (target === 'actions') eventActionsJson.value = def.join('\n');
  if (target === 'subjects') eventSubjectsJson.value = def.join('\n');
}

async function saveUNE() {
  if (!isPresetContentEditable()) return;
  const modifiers = modifiersJson.value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const nouns = nounsJson.value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const motivation_verbs = motivationVerbsJson.value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const motivation_nouns = motivationNounsJson.value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  currentPreset.value.data.une = { modifiers, nouns, motivation_verbs, motivation_nouns };
  props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.uneUpdated'), 'success');
}

function resetUNE() {
  if (!isPresetContentEditable()) return;
  modifiersJson.value = DEFAULT_UNE_SETTINGS.modifiers.join('\n');
  nounsJson.value = DEFAULT_UNE_SETTINGS.nouns.join('\n');
  motivationVerbsJson.value = DEFAULT_UNE_SETTINGS.motivation_verbs.join('\n');
  motivationNounsJson.value = DEFAULT_UNE_SETTINGS.motivation_nouns.join('\n');
  saveUNE();
}

async function saveCharacterTypes() {
  if (!isPresetContentEditable()) return;
  const data = characterTypesJson.value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  currentPreset.value.data.characterTypes = data;
  props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.characterTypesUpdated'), 'success');
}

function resetCharacterTypes() {
  if (!isPresetContentEditable()) return;
  characterTypesJson.value = 'NPC\nPC';
  saveCharacterTypes();
}

// Preset Handlers

async function handleCreatePreset() {
  const result = await popupStore.show({
    type: POPUP_TYPE.INPUT,
    content: t('extensionsBuiltin.mythicAgents.popups.enterPresetName'),
    inputRequired: true,
    okButton: true,
    cancelButton: true,
  });
  if (result.result === 1 && result.value && typeof result.value === 'string' && result.value.trim()) {
    const presetName = result.value.trim();
    if (settings.value.presets.some((p) => p.name === presetName)) {
      props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.presetNameExists'), 'error');
      return;
    }
    const newPreset: MythicPreset = {
      name: presetName,
      data: {
        fateChart: JSON.parse(JSON.stringify(currentPreset.value.data.fateChart)),
        eventGeneration: JSON.parse(JSON.stringify(currentPreset.value.data.eventGeneration)),
        une: JSON.parse(JSON.stringify(currentPreset.value.data.une)),
        characterTypes: [...currentPreset.value.data.characterTypes],
      },
    };
    settings.value.presets.push(newPreset);
    selectedPreset.value = presetName;
    settings.value.selectedPreset = presetName;
  }
}

async function handleEditPreset() {
  if (!selectedPreset.value) return;
  const result = await popupStore.show({
    type: POPUP_TYPE.INPUT,
    content: t('extensionsBuiltin.mythicAgents.popups.enterNewPresetName'),
    inputValue: selectedPreset.value,
    inputRequired: true,
    okButton: true,
    cancelButton: true,
  });
  if (result.result === 1 && result.value && typeof result.value === 'string' && result.value.trim()) {
    if (isCurrentPresetBuiltIn.value) {
      props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.builtInCannotRename'), 'error');
      return;
    }
    const presetName = result.value.trim();
    if (settings.value.presets.some((p) => p.name === presetName && p.name !== selectedPreset.value)) {
      props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.presetNameExists'), 'error');
      return;
    }
    const preset = settings.value.presets.find((p) => p.name === selectedPreset.value);
    if (preset) {
      preset.name = presetName;
      selectedPreset.value = presetName;
    }
  }
}

async function handleDeletePreset() {
  if (!selectedPreset.value) return;
  if (isCurrentPresetBuiltIn.value) {
    props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.builtInCannotDelete'), 'error');
    return;
  }
  if (settings.value.presets.length <= 1) {
    props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.cannotDeleteLastPreset'), 'error');
    return;
  }
  const confirm = await popupStore.show({
    type: POPUP_TYPE.CONFIRM,
    content: t('extensionsBuiltin.mythicAgents.popups.deletePreset', { name: selectedPreset.value }),
    okButton: true,
    cancelButton: true,
  });
  if (confirm) {
    settings.value.presets = settings.value.presets.filter((p) => p.name !== selectedPreset.value);
    if (selectedPreset.value !== 'Default') {
      selectedPreset.value = 'Default';
      settings.value.selectedPreset = 'Default';
    }
  }
}

function handleImportPreset() {
  importMode.value = 'array';
  fileInputRef.value?.click();
}

function handleImportSinglePreset() {
  importMode.value = 'single';
  fileInputRef.value?.click();
}

function handleExportPreset() {
  const dataStr = JSON.stringify(settings.value.presets, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mythic-presets.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function handleExportActivePreset() {
  const dataStr = JSON.stringify(currentPreset.value, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${currentPreset.value.name}-preset.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function handleFileImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      if (importMode.value === 'single') {
        const importedPreset: MythicPreset = JSON.parse(e.target?.result as string);
        if (typeof importedPreset === 'object' && importedPreset.name) {
          if (!settings.value.presets.some((p) => p.name === importedPreset.name)) {
            importedPreset.builtIn = false;
            settings.value.presets.push(importedPreset);
            props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.presetImported'), 'success');
          } else {
            props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.presetNameExists'), 'error');
          }
        } else {
          props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.invalidPresetFormat'), 'error');
        }
      } else {
        const importedPresets: MythicPreset[] = JSON.parse(e.target?.result as string);
        if (Array.isArray(importedPresets)) {
          for (const preset of importedPresets) {
            if (!settings.value.presets.some((p) => p.name === preset.name)) {
              preset.builtIn = false;
              settings.value.presets.push(preset);
            }
          }
          props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.presetsImported'), 'success');
        } else {
          props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.invalidFileFormat'), 'error');
        }
      }
    } catch {
      props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.invalidJson'), 'error');
    }
  };
  reader.readAsText(file);
}

async function handleResetAllPresets() {
  const confirm = await popupStore.show({
    type: POPUP_TYPE.CONFIRM,
    content: t('extensionsBuiltin.mythicAgents.popups.resetAllContent'),
    okButton: true,
    cancelButton: true,
  });
  if (confirm) {
    const defaults = cloneDefaultMythicSettings();
    settings.value.prompts = defaults.prompts;
    settings.value.presets = defaults.presets;
    selectedPreset.value = 'Default';
    settings.value.selectedPreset = 'Default';
    loadJsonFromSettings();
    props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.contentReset'), 'success');
  }
}

// Lifecycle

onMounted(async () => {
  const saved = props.api.settings.get();
  settings.value = migrateMythicSettings(saved);
  selectedPreset.value = settings.value.selectedPreset;
  try {
    loadJsonFromSettings();
    const errors = validateCurrentPreset();
    if (errors.length > 0) {
      props.api.ui.showToast(
        t('extensionsBuiltin.mythicAgents.toasts.presetValidationErrors', { name: selectedPreset.value }),
        'error',
      );
      console.error('Preset validation errors:', errors);
    }
  } catch (error) {
    console.error('Failed to load preset data:', error);
    props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.loadPresetFailed'), 'error');
    await handleResetAllPresets();
  }
});

watch(selectedPreset, async (newPreset) => {
  if (newPreset) {
    try {
      settings.value.selectedPreset = newPreset;
      loadJsonFromSettings();
      const errors = validateCurrentPreset();
      if (errors.length > 0) {
        props.api.ui.showToast(
          t('extensionsBuiltin.mythicAgents.toasts.presetValidationErrors', { name: newPreset }),
          'error',
        );
        console.error('Preset validation errors:', errors);
      }
    } catch (error) {
      console.error('Failed to load preset data:', error);
      props.api.ui.showToast(t('extensionsBuiltin.mythicAgents.toasts.loadPresetFailed'), 'error');
      await handleResetAllPresets();
    }
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

// Prompt Tools
const getPromptTools = (type: keyof NonNullable<MythicSettings['prompts']>) => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('extensionsBuiltin.mythicAgents.resetToDefault'),
    onClick: async ({ setValue }: { setValue: (value: string) => void }) => {
      const confirm = await popupStore.show({
        type: POPUP_TYPE.CONFIRM,
        content: t('extensionsBuiltin.mythicAgents.popups.resetPromptContent'),
        okButton: true,
        cancelButton: true,
      });
      if (confirm) {
        let defaultPrompt = '';
        if (type === 'initialScene') defaultPrompt = INITIAL_SCENE_PROMPT;
        if (type === 'analysis') defaultPrompt = ANALYSIS_PROMPT;
        if (type === 'narration') defaultPrompt = NARRATION_PROMPT;
        setValue(defaultPrompt);
      }
    },
  },
];

const fateChartTools = [
  {
    id: 'save',
    icon: 'fa-save',
    title: t('common.apply'),
    onClick: saveFateChart,
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: t('common.reset'),
    onClick: resetFateChart,
  },
];

const eventFocusesTools = [
  {
    id: 'save',
    icon: 'fa-save',
    title: t('common.apply'),
    onClick: saveEventFocuses,
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: t('common.reset'),
    onClick: resetEventFocuses,
  },
];

const eventActionsTools = [
  {
    id: 'save',
    icon: 'fa-save',
    title: t('common.apply'),
    onClick: () => saveStringArray('actions', eventActionsJson.value),
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: t('common.reset'),
    onClick: () => resetStringArray('actions'),
  },
];

const eventSubjectsTools = [
  {
    id: 'save',
    icon: 'fa-save',
    title: t('common.apply'),
    onClick: () => saveStringArray('subjects', eventSubjectsJson.value),
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: t('common.reset'),
    onClick: () => resetStringArray('subjects'),
  },
];

const uneTools = [
  {
    id: 'save',
    icon: 'fa-save',
    title: t('common.apply'),
    onClick: saveUNE,
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: t('common.reset'),
    onClick: resetUNE,
  },
];

const characterTypesTools = [
  {
    id: 'save',
    icon: 'fa-save',
    title: t('common.apply'),
    onClick: saveCharacterTypes,
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: t('common.reset'),
    onClick: resetCharacterTypes,
  },
];

const customActions: CustomAction[] = [
  {
    key: 'exportActive',
    icon: 'fa-file-export',
    title: 'common.exportActive',
    event: 'exportActive',
    variant: 'ghost',
  },
  {
    key: 'importSingle',
    icon: 'fa-file-import',
    title: 'common.importSingle',
    event: 'importSingle',
    variant: 'ghost',
  },
  {
    key: 'resetAll',
    icon: 'fa-undo',
    title: 'common.reset',
    event: 'resetAll',
    variant: 'danger',
  },
];
</script>

<template>
  <div class="mythic-settings">
    <div class="preset-section">
      <PresetControl
        v-model="selectedPreset"
        :options="settings.presets.map((p) => ({ label: p.name, value: p.name }))"
        :allow-create="true"
        :allow-edit="!isCurrentPresetBuiltIn"
        :allow-delete="!isCurrentPresetBuiltIn && settings.presets.length > 1"
        :allow-import="true"
        :allow-export="true"
        :allow-save="false"
        :custom-actions="customActions"
        :action-order="[
          'save',
          'create',
          'edit',
          'delete',
          'import',
          'export',
          'exportActive',
          'importSingle',
          'resetAll',
        ]"
        @create="handleCreatePreset"
        @edit="handleEditPreset"
        @delete="handleDeletePreset"
        @import="handleImportPreset"
        @export="handleExportPreset"
        @export-active="handleExportActivePreset"
        @import-single="handleImportSinglePreset"
        @reset-all="handleResetAllPresets"
      />
    </div>
    <input ref="fileInputRef" type="file" accept=".json" style="display: none" @change="handleFileImport" />

    <Tabs v-model="activeTab" :options="mainTabs" class="main-tabs" />

    <div v-if="activeTab === 'general'" class="tab-content">
      <div class="group-header">{{ t('extensionsBuiltin.mythicAgents.generalConfiguration') }}</div>
      <FormItem :label="t('extensionsBuiltin.mythicAgents.enable')">
        <Toggle v-model="settings.enabled" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.mythicAgents.autoAnalyze')"
        :description="t('extensionsBuiltin.mythicAgents.autoAnalyzeHint')"
      >
        <Toggle v-model="settings.autoAnalyze" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.mythicAgents.autoUpdateScene')"
        :description="t('extensionsBuiltin.mythicAgents.autoUpdateSceneHint')"
      >
        <Toggle v-model="settings.autoSceneUpdate" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.mythicAgents.connectionProfile')"
        :description="t('extensionsBuiltin.mythicAgents.connectionProfileHint')"
      >
        <ConnectionProfileSelector v-model="settings.connectionProfileId" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.mythicAgents.defaultChaosRank')"
        :description="t('extensionsBuiltin.mythicAgents.defaultChaosRankHint')"
      >
        <Input v-model.number="settings.chaos" type="number" :min="1" :max="9" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.mythicAgents.language')"
        :description="t('extensionsBuiltin.mythicAgents.languageHint')"
      >
        <Input v-model="settings.language" :placeholder="t('extensionsBuiltin.mythicAgents.languagePlaceholder')" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.mythicAgents.requestFormat')"
        :description="t('extensionsBuiltin.mythicAgents.requestFormatHint')"
      >
        <Select v-model="settings.structuredRequestFormat" :options="formatOptions" />
      </FormItem>
    </div>

    <div v-if="activeTab === 'prompts'" class="tab-content">
      <Tabs v-model="activePromptTab" :options="promptTypes.map((t) => ({ label: t.label, value: t.key }))" />
      <div v-for="prompt in promptTypes" :key="prompt.key">
        <div v-if="activePromptTab === prompt.key">
          <Textarea
            v-model="settings.prompts[prompt.key]"
            :rows="20"
            :disabled="isCurrentPresetBuiltIn"
            allow-maximize
            :identifier="`extension.mythic-agents.${prompt.key}`"
            :tools="isCurrentPresetBuiltIn ? [] : getPromptTools(prompt.key)"
          />
        </div>
      </div>
    </div>

    <div v-if="activeTab === 'fateChart'" class="tab-content">
      <Textarea
        v-model="fateChartJson"
        :rows="20"
        :disabled="isCurrentPresetBuiltIn"
        :identifier="'extension.mythic-agents.fateChart'"
        :tools="isCurrentPresetBuiltIn ? [] : fateChartTools"
      />
    </div>

    <div v-if="activeTab === 'eventTables'" class="tab-content">
      <CollapsibleSection :title="t('extensionsBuiltin.mythicAgents.eventFocusesWeighted')">
        <p class="help-text">
          Use <code>min</code> and <code>max</code> (1-100) for probability. <code>action</code> supports logic like
          <code>(random_npc or random_pc) and new_warrior</code>.
        </p>
        <Textarea
          v-model="eventFocusesJson"
          :rows="15"
          :disabled="isCurrentPresetBuiltIn"
          :identifier="'extension.mythic-agents.eventFocuses'"
          :tools="isCurrentPresetBuiltIn ? [] : eventFocusesTools"
        />
      </CollapsibleSection>

      <CollapsibleSection :title="t('extensionsBuiltin.mythicAgents.eventActions')">
        <Textarea
          v-model="eventActionsJson"
          :rows="10"
          :disabled="isCurrentPresetBuiltIn"
          :identifier="'extension.mythic-agents.eventActions'"
          :tools="isCurrentPresetBuiltIn ? [] : eventActionsTools"
        />
      </CollapsibleSection>

      <CollapsibleSection :title="t('extensionsBuiltin.mythicAgents.eventSubjects')">
        <Textarea
          v-model="eventSubjectsJson"
          :rows="10"
          :disabled="isCurrentPresetBuiltIn"
          :identifier="'extension.mythic-agents.eventSubjects'"
          :tools="isCurrentPresetBuiltIn ? [] : eventSubjectsTools"
        />
      </CollapsibleSection>

      <CollapsibleSection :title="t('extensionsBuiltin.mythicAgents.characterTypes')">
        <Textarea
          v-model="characterTypesJson"
          :rows="5"
          :disabled="isCurrentPresetBuiltIn"
          :identifier="'extension.mythic-agents.characterTypes'"
          :tools="isCurrentPresetBuiltIn ? [] : characterTypesTools"
        />
      </CollapsibleSection>
    </div>

    <div v-if="activeTab === 'une'" class="tab-content">
      <CollapsibleSection :title="t('extensionsBuiltin.mythicAgents.modifiers')">
        <Textarea
          v-model="modifiersJson"
          :rows="5"
          :disabled="isCurrentPresetBuiltIn"
          :identifier="'extension.mythic-agents.modifiers'"
          :tools="isCurrentPresetBuiltIn ? [] : uneTools"
        />
      </CollapsibleSection>

      <CollapsibleSection :title="t('extensionsBuiltin.mythicAgents.nouns')">
        <Textarea
          v-model="nounsJson"
          :rows="5"
          :disabled="isCurrentPresetBuiltIn"
          :identifier="'extension.mythic-agents.nouns'"
          :tools="isCurrentPresetBuiltIn ? [] : uneTools"
        />
      </CollapsibleSection>

      <CollapsibleSection :title="t('extensionsBuiltin.mythicAgents.motivationVerbs')">
        <Textarea
          v-model="motivationVerbsJson"
          :rows="5"
          :disabled="isCurrentPresetBuiltIn"
          :identifier="'extension.mythic-agents.motivationVerbs'"
          :tools="isCurrentPresetBuiltIn ? [] : uneTools"
        />
      </CollapsibleSection>

      <CollapsibleSection :title="t('extensionsBuiltin.mythicAgents.motivationNouns')">
        <Textarea
          v-model="motivationNounsJson"
          :rows="5"
          :disabled="isCurrentPresetBuiltIn"
          :identifier="'extension.mythic-agents.motivationNouns'"
          :tools="isCurrentPresetBuiltIn ? [] : uneTools"
        />
      </CollapsibleSection>
    </div>
  </div>
</template>

<style scoped lang="scss">
.mythic-settings {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
}

.preset-section {
  margin-bottom: var(--spacing-md);
}

.group-header {
  font-weight: bold;
  font-size: 1.1em;
  color: var(--theme-text-color);
  border-bottom: 1px solid var(--theme-border-color);
  padding-bottom: var(--spacing-xs);
  margin-top: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.json-editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-sm);
  font-weight: 600;
  color: var(--theme-emphasis-color);

  .actions {
    display: flex;
    gap: var(--spacing-sm);
  }
}

.help-text {
  font-size: 0.85em;
  color: var(--theme-emphasis-color);
  margin-bottom: var(--spacing-sm);

  code {
    background-color: var(--black-50a);
    padding: 2px 4px;
    border-radius: 4px;
  }
}

.main-tabs {
  margin-bottom: var(--spacing-md);
}
</style>
