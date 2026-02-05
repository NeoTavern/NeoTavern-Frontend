<script setup lang="ts">
import type { Expression } from 'jsep';
import jsep from 'jsep';
import { onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Toggle } from '../../../components/UI';
import CollapsibleSection from '../../../components/UI/CollapsibleSection.vue';
import Tabs from '../../../components/UI/Tabs.vue';
import Textarea from '../../../components/UI/Textarea.vue';
import { usePopupStore } from '../../../stores/popup.store';
import type { ExtensionAPI } from '../../../types';
import { POPUP_TYPE } from '../../../types';
import { DEFAULT_EVENT_GENERATION_DATA, DEFAULT_FATE_CHART_DATA, DEFAULT_UNE_SETTINGS } from './defaults';
import { ANALYSIS_PROMPT, INITIAL_SCENE_PROMPT, NARRATION_PROMPT, SCENE_UPDATE_PROMPT } from './prompts';
import type { EventFocus, FateChartData, MythicChatExtra, MythicMessageExtra, MythicSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<MythicSettings, MythicChatExtra, MythicMessageExtra>;
}>();

const initial: MythicSettings = {
  enabled: true,
  autoAnalyze: true,
  chaos: 5,
  connectionProfileId: '',
  language: 'English',
  prompts: {
    initialScene: INITIAL_SCENE_PROMPT,
    sceneUpdate: SCENE_UPDATE_PROMPT,
    analysis: ANALYSIS_PROMPT,
    narration: NARRATION_PROMPT,
  },
  fateChart: DEFAULT_FATE_CHART_DATA,
  eventGeneration: DEFAULT_EVENT_GENERATION_DATA,
  une: DEFAULT_UNE_SETTINGS,
  characterTypes: ['NPC', 'PC'],
};

const settings = ref<MythicSettings>(JSON.parse(JSON.stringify(initial)));
const popupStore = usePopupStore();
const activeTab = ref('general');
const activePromptTab = ref('initialScene');

const mainTabs = [
  { label: 'General', value: 'general' },
  { label: 'Prompts', value: 'prompts' },
  { label: 'Fate Chart', value: 'fateChart' },
  { label: 'Event Tables', value: 'eventTables' },
  { label: 'UNE', value: 'une' },
];

const promptTypes: { key: keyof NonNullable<MythicSettings['prompts']>; label: string }[] = [
  { key: 'initialScene', label: 'Initial Scene' },
  { key: 'sceneUpdate', label: 'Scene Update' },
  { key: 'analysis', label: 'Analysis' },
  { key: 'narration', label: 'Narration' },
];

// JSON Editors State
const fateChartJson = ref('');
const eventFocusesJson = ref('');
const eventActionsJson = ref('');
const eventSubjectsJson = ref('');
const uneJson = ref('');
const characterTypesJson = ref('');

function loadJsonFromSettings() {
  fateChartJson.value = JSON.stringify(settings.value.fateChart, null, 2);
  eventFocusesJson.value = JSON.stringify(settings.value.eventGeneration.focuses, null, 2);
  eventActionsJson.value = settings.value.eventGeneration.actions.join('\n');
  eventSubjectsJson.value = settings.value.eventGeneration.subjects.join('\n');
  uneJson.value = JSON.stringify(settings.value.une, null, 2);
  characterTypesJson.value = settings.value.characterTypes.join('\n');
}

// Validation Logic

function validateFateChart(data: FateChartData): string[] {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null) {
    return ['Root must be an object.'];
  }

  const requiredRanks = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  let requiredOdds: string[] | null = null;

  for (const rank of requiredRanks) {
    if (data[rank] && typeof data[rank] === 'object' && data[rank] !== null) {
      requiredOdds = Object.keys(data[rank]);
      break;
    }
  }

  if (!requiredOdds) {
    return ['No valid Chaos Ranks found to establish a baseline for odds.'];
  }

  for (const rank of requiredRanks) {
    if (!data[rank]) {
      errors.push(`Missing Chaos Rank: "${rank}"`);
      continue;
    }
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

  const characterTypes = settings.value.characterTypes || ['NPC'];
  const validActions = [
    'random_thread',
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

// Handlers for Save/Reset

async function saveFateChart() {
  try {
    const data = JSON.parse(fateChartJson.value);
    const errors = validateFateChart(data);
    if (errors.length > 0) {
      await popupStore.show({
        type: POPUP_TYPE.TEXT,
        title: 'Validation Errors',
        content: errors.join('\n'),
        okButton: true,
      });
      return;
    }
    settings.value.fateChart = data;
    props.api.ui.showToast('Fate Chart updated', 'success');
  } catch {
    props.api.ui.showToast('Invalid JSON', 'error');
  }
}

async function resetFateChart() {
  fateChartJson.value = JSON.stringify(DEFAULT_FATE_CHART_DATA, null, 2);
  saveFateChart();
}

async function saveEventFocuses() {
  try {
    const data = JSON.parse(eventFocusesJson.value);
    const errors = validateFocuses(data);
    if (errors.length > 0) {
      await popupStore.show({
        type: POPUP_TYPE.TEXT,
        title: 'Validation Errors',
        content: errors.join('\n'),
        okButton: true,
      });
      return;
    }
    settings.value.eventGeneration.focuses = data;
    props.api.ui.showToast('Event Focuses updated', 'success');
  } catch {
    props.api.ui.showToast('Invalid JSON', 'error');
  }
}

function resetEventFocuses() {
  eventFocusesJson.value = JSON.stringify(DEFAULT_EVENT_GENERATION_DATA.focuses, null, 2);
  saveEventFocuses();
}

function saveStringArray(target: 'actions' | 'subjects', jsonValue: string) {
  const data = jsonValue
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  settings.value.eventGeneration[target] = data;
  props.api.ui.showToast(`${target} updated`, 'success');
}

function resetStringArray(target: 'actions' | 'subjects') {
  const def = DEFAULT_EVENT_GENERATION_DATA[target];
  if (target === 'actions') eventActionsJson.value = def.join('\n');
  if (target === 'subjects') eventSubjectsJson.value = def.join('\n');
  settings.value.eventGeneration[target] = def;
}

async function saveUNE() {
  try {
    const data = JSON.parse(uneJson.value);
    if (!data.modifiers || !data.nouns || !data.motivation_verbs || !data.motivation_nouns) {
      props.api.ui.showToast('Invalid UNE structure. Missing keys.', 'error');
      return;
    }
    settings.value.une = data;
    props.api.ui.showToast('UNE settings updated', 'success');
  } catch {
    props.api.ui.showToast('Invalid JSON', 'error');
  }
}

function resetUNE() {
  uneJson.value = JSON.stringify(DEFAULT_UNE_SETTINGS, null, 2);
  saveUNE();
}

async function saveCharacterTypes() {
  const data = characterTypesJson.value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  settings.value.characterTypes = data;
  props.api.ui.showToast('Character Types updated', 'success');
}

function resetCharacterTypes() {
  characterTypesJson.value = 'NPC\nPC';
  saveCharacterTypes();
}

// Lifecycle

onMounted(() => {
  const saved = props.api.settings.get();
  if (saved) {
    // Migration checks could go here if moving from old version
    settings.value = { ...initial, ...saved };
  }
  loadJsonFromSettings();
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
    title: 'Reset to Default',
    onClick: async ({ setValue }: { setValue: (value: string) => void }) => {
      const confirm = await popupStore.show({
        type: POPUP_TYPE.CONFIRM,
        content: 'Are you sure you want to reset this prompt to default?',
        okButton: true,
        cancelButton: true,
      });
      if (confirm) {
        let defaultPrompt = '';
        if (type === 'initialScene') defaultPrompt = INITIAL_SCENE_PROMPT;
        if (type === 'sceneUpdate') defaultPrompt = SCENE_UPDATE_PROMPT;
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
    title: 'Apply',
    onClick: saveFateChart,
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: 'Reset',
    onClick: resetFateChart,
  },
];

const eventFocusesTools = [
  {
    id: 'save',
    icon: 'fa-save',
    title: 'Apply',
    onClick: saveEventFocuses,
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: 'Reset',
    onClick: resetEventFocuses,
  },
];

const eventActionsTools = [
  {
    id: 'save',
    icon: 'fa-save',
    title: 'Apply',
    onClick: () => saveStringArray('actions', eventActionsJson.value),
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: 'Reset',
    onClick: () => resetStringArray('actions'),
  },
];

const eventSubjectsTools = [
  {
    id: 'save',
    icon: 'fa-save',
    title: 'Apply',
    onClick: () => saveStringArray('subjects', eventSubjectsJson.value),
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: 'Reset',
    onClick: () => resetStringArray('subjects'),
  },
];

const uneTools = [
  {
    id: 'save',
    icon: 'fa-save',
    title: 'Apply',
    onClick: saveUNE,
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: 'Reset',
    onClick: resetUNE,
  },
];

const characterTypesTools = [
  {
    id: 'save',
    icon: 'fa-save',
    title: 'Apply',
    onClick: saveCharacterTypes,
  },
  {
    id: 'reset',
    icon: 'fa-undo',
    title: 'Reset',
    onClick: resetCharacterTypes,
  },
];
</script>

<template>
  <div class="mythic-settings">
    <Tabs v-model="activeTab" :options="mainTabs" class="main-tabs" />

    <div v-if="activeTab === 'general'" class="tab-content">
      <div class="group-header">General Configuration</div>
      <FormItem label="Enable Mythic Agents Extension">
        <Toggle v-model="settings.enabled" />
      </FormItem>
      <FormItem
        label="Auto-Analyze User Messages"
        description="Automatically analyze user messages for implied questions and roll fate when Mythic is active."
      >
        <Toggle v-model="settings.autoAnalyze" />
      </FormItem>
      <FormItem
        label="Connection Profile"
        description="The connection profile to use for LLM analysis and event generation."
      >
        <ConnectionProfileSelector v-model="settings.connectionProfileId" />
      </FormItem>
      <FormItem label="Default Chaos Rank" description="The default chaos rank for new scenes (1-9).">
        <Input v-model.number="settings.chaos" type="number" :min="1" :max="9" />
      </FormItem>
      <FormItem label="Language" description="The language for generated content.">
        <Input v-model="settings.language" placeholder="English" />
      </FormItem>
    </div>

    <div v-if="activeTab === 'prompts'" class="tab-content">
      <Tabs v-model="activePromptTab" :options="promptTypes.map((t) => ({ label: t.label, value: t.key }))" />
      <div v-for="prompt in promptTypes" :key="prompt.key">
        <div v-if="activePromptTab === prompt.key">
          <Textarea
            v-model="settings.prompts[prompt.key]"
            :rows="20"
            allow-maximize
            :identifier="`extension.mythic-agents.${prompt.key}`"
            :tools="getPromptTools(prompt.key)"
          />
        </div>
      </div>
    </div>

    <div v-if="activeTab === 'fateChart'" class="tab-content">
      <Textarea
        v-model="fateChartJson"
        :rows="20"
        :identifier="'extension.mythic-agents.fateChart'"
        :tools="fateChartTools"
      />
    </div>

    <div v-if="activeTab === 'eventTables'" class="tab-content">
      <CollapsibleSection title="Event Focuses (Weighted Table)">
        <p class="help-text">
          Use <code>min</code> and <code>max</code> (1-100) for probability. <code>action</code> supports logic like
          <code>(random_npc or random_pc) and new_warrior</code>.
        </p>
        <Textarea
          v-model="eventFocusesJson"
          :rows="15"
          :identifier="'extension.mythic-agents.eventFocuses'"
          :tools="eventFocusesTools"
        />
      </CollapsibleSection>

      <CollapsibleSection title="Event Actions">
        <Textarea
          v-model="eventActionsJson"
          :rows="10"
          :identifier="'extension.mythic-agents.eventActions'"
          :tools="eventActionsTools"
        />
      </CollapsibleSection>

      <CollapsibleSection title="Event Subjects">
        <Textarea
          v-model="eventSubjectsJson"
          :rows="10"
          :identifier="'extension.mythic-agents.eventSubjects'"
          :tools="eventSubjectsTools"
        />
      </CollapsibleSection>

      <CollapsibleSection title="Character Types">
        <Textarea
          v-model="characterTypesJson"
          :rows="5"
          :identifier="'extension.mythic-agents.characterTypes'"
          :tools="characterTypesTools"
        />
      </CollapsibleSection>
    </div>

    <div v-if="activeTab === 'une'" class="tab-content">
      <Textarea v-model="uneJson" :rows="20" :identifier="'extension.mythic-agents.une'" :tools="uneTools" />
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
