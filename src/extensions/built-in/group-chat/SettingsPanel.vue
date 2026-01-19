<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Textarea } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import type { TextareaToolDefinition } from '../../../types/ExtensionAPI';
import {
  DEFAULT_DECISION_TEMPLATE,
  DEFAULT_SUMMARY_INJECTION_TEMPLATE,
  DEFAULT_SUMMARY_TEMPLATE,
} from './GroupChatService';
import type { GroupExtensionSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<GroupExtensionSettings>;
}>();

const t = props.api.i18n.t;

const settings = ref<GroupExtensionSettings>({
  defaultDecisionPromptTemplate: DEFAULT_DECISION_TEMPLATE,
  defaultSummaryPromptTemplate: DEFAULT_SUMMARY_TEMPLATE,
  summaryInjectionTemplate: DEFAULT_SUMMARY_INJECTION_TEMPLATE,
  defaultConnectionProfile: undefined,
});

onMounted(() => {
  const saved = props.api.settings.get();
  if (saved) {
    settings.value = {
      defaultDecisionPromptTemplate: saved.defaultDecisionPromptTemplate || DEFAULT_DECISION_TEMPLATE,
      defaultSummaryPromptTemplate: saved.defaultSummaryPromptTemplate || DEFAULT_SUMMARY_TEMPLATE,
      summaryInjectionTemplate: saved.summaryInjectionTemplate || DEFAULT_SUMMARY_INJECTION_TEMPLATE,
      defaultConnectionProfile: saved.defaultConnectionProfile,
    };
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

const decisionPromptTools = computed<TextareaToolDefinition[]>(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: 'Reset to default',
    onClick: ({ setValue }) => {
      setValue(DEFAULT_DECISION_TEMPLATE);
    },
  },
]);

const summaryPromptTools = computed<TextareaToolDefinition[]>(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: 'Reset to default',
    onClick: ({ setValue }) => {
      setValue(DEFAULT_SUMMARY_TEMPLATE);
    },
  },
]);

const summaryInjectionTools = computed<TextareaToolDefinition[]>(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: 'Reset to default',
    onClick: ({ setValue }) => {
      setValue(DEFAULT_SUMMARY_INJECTION_TEMPLATE);
    },
  },
]);
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

      <FormItem
        :label="t('extensionsBuiltin.groupChat.settings.llmDecisionPrompt')"
        :description="t('extensionsBuiltin.groupChat.settings.llmDecisionPromptDesc')"
      >
        <div class="textarea-container">
          <Textarea
            v-model="settings.defaultDecisionPromptTemplate"
            :rows="8"
            allow-maximize
            identifier="extension.group-chat.decision"
            :tools="decisionPromptTools"
          />
        </div>
        <div class="help-text">
          Available macros: <code>{{ '{' + '{user}' + '}' }}</code
          >, <code>{{ '{' + '{memberNames}' + '}' }}</code
          >, <code>{{ '{' + '{recentMessages}' + '}' }}</code
          >, <code>{{ '{' + '{firstCharName}' + '}' }}</code>
        </div>
      </FormItem>

      <FormItem
        :label="t('extensionsBuiltin.groupChat.settings.aiSummaryPrompt')"
        :description="t('extensionsBuiltin.groupChat.settings.aiSummaryPromptDesc')"
      >
        <div class="textarea-container">
          <Textarea
            v-model="settings.defaultSummaryPromptTemplate"
            :rows="6"
            allow-maximize
            identifier="extension.group-chat.summary"
            :tools="summaryPromptTools"
          />
        </div>
        <div class="help-text">
          Available macros: <code>{{ '{' + '{name}' + '}' }}</code
          >, <code>{{ '{' + '{description}' + '}' }}</code
          >, <code>{{ '{' + '{personality}' + '}' }}</code>
        </div>
      </FormItem>

      <FormItem
        :label="t('extensionsBuiltin.groupChat.settings.summaryInjectionTemplate')"
        :description="t('extensionsBuiltin.groupChat.settings.summaryInjectionTemplateDesc')"
      >
        <div class="textarea-container">
          <Textarea
            v-model="settings.summaryInjectionTemplate"
            :rows="4"
            allow-maximize
            identifier="extension.group-chat.injection"
            :tools="summaryInjectionTools"
          />
        </div>
        <div class="help-text">
          Available macros: <code>{{ '{' + '{summaries}' + '}' }}</code> (formatted member summaries),
          <code>{{ '{' + '{description}' + '}' }}</code
          >, <code>{{ '{' + '{personality}' + '}' }}</code
          >, <code>{{ '{' + '{scenario}' + '}' }}</code
          >, and other character fields
        </div>
      </FormItem>
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
