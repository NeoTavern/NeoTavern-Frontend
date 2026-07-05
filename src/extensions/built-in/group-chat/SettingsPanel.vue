<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import PromptPresetField from '../PromptPresetField.vue';
import { BUILT_IN_PROMPT_PRESETS, DEFAULT_SETTINGS, migrateGroupChatSettings, type GroupChatPrompts } from './types';
import type { GroupExtensionSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<GroupExtensionSettings>;
}>();

const t = props.api.i18n.t;

const settings = ref<GroupExtensionSettings>({ ...DEFAULT_SETTINGS });

onMounted(() => {
  settings.value = migrateGroupChatSettings(props.api.settings.get());
});

watch(
  settings,
  (newSettings) => {
    props.api.settings.set(undefined, newSettings);
    props.api.settings.save();
  },
  { deep: true },
);

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;

function updatePromptPresets(presets: GroupExtensionSettings['promptPresets']) {
  settings.value.promptPresets = presets;
}

function updateActivePreset(id: string) {
  settings.value.activePromptPresetId = id;
}

function formatMacro(macro: string): string {
  return `{{${macro}}}`;
}

const promptFields: Array<{
  key: keyof GroupChatPrompts;
  label: string;
  description: string;
  identifier: string;
  rows: number;
  helpMacros: string[];
}> = [
  {
    key: 'defaultDecisionPromptTemplate',
    label: t('extensionsBuiltin.groupChat.settings.llmDecisionPrompt'),
    description: t('extensionsBuiltin.groupChat.settings.llmDecisionPromptDesc'),
    identifier: 'extension.group-chat.decision',
    rows: 8,
    helpMacros: ['user', 'memberNames', 'recentMessages', 'firstCharName'],
  },
  {
    key: 'defaultSummaryPromptTemplate',
    label: t('extensionsBuiltin.groupChat.settings.aiSummaryPrompt'),
    description: t('extensionsBuiltin.groupChat.settings.aiSummaryPromptDesc'),
    identifier: 'extension.group-chat.summary',
    rows: 6,
    helpMacros: ['name', 'description', 'personality'],
  },
  {
    key: 'summaryInjectionTemplate',
    label: t('extensionsBuiltin.groupChat.settings.summaryInjectionTemplate'),
    description: t('extensionsBuiltin.groupChat.settings.summaryInjectionTemplateDesc'),
    identifier: 'extension.group-chat.injection',
    rows: 4,
    helpMacros: ['summaries', 'description', 'personality', 'scenario'],
  },
];
</script>

<template>
  <div class="group-settings-panel">
    <div class="settings-section">
      <h3>{{ t('common.general') }}</h3>
      <FormItem
        :label="t('extensionsBuiltin.groupChat.settings.defaultConnectionProfile')"
        :description="t('extensionsBuiltin.groupChat.settings.defaultConnectionProfileDesc')"
      >
        <ConnectionProfileSelector v-model="settings.defaultConnectionProfile" />
      </FormItem>
    </div>

    <div class="settings-section">
      <h3>{{ t('extensionsBuiltin.groupChat.settings.defaultTemplates') }}</h3>
      <p class="section-description">
        {{ t('extensionsBuiltin.groupChat.settings.defaultTemplatesDesc') }}
      </p>

      <div v-for="field in promptFields" :key="field.key">
        <PromptPresetField
          :api="api"
          :active-preset-id="settings.activePromptPresetId"
          :prompt-presets="settings.promptPresets"
          :built-in-presets="builtInPromptPresets"
          :prompt-key="field.key"
          :label="field.label"
          :description="field.description"
          :identifier="field.identifier"
          :rows="field.rows"
          @update:active-preset-id="updateActivePreset"
          @update:prompt-presets="updatePromptPresets"
        />
        <div class="help-text">
          Available macros:
          <template v-for="(macro, index) in field.helpMacros" :key="macro">
            <span v-if="index > 0">, </span><code>{{ formatMacro(macro) }}</code>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.group-settings-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xl);
  padding: var(--spacing-md);
  height: 100%;
  overflow-y: auto;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);

  h3 {
    margin: 0;
    font-size: 1.2em;
    font-weight: bold;
    border-bottom: 1px solid var(--theme-border-color);
    padding-bottom: var(--spacing-xs);
  }
}

.section-description {
  margin: 0;
  font-size: 0.9em;
  opacity: 0.8;
}

.textarea-container {
  position: relative;
}

.help-text {
  font-size: 0.85em;
  opacity: 0.8;
  margin-top: var(--spacing-xs);

  code {
    background-color: var(--black-30a);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: var(--font-family-mono);
  }
}
</style>
