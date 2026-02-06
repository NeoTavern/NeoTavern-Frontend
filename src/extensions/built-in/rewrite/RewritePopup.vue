<script setup lang="ts">
import { computed, markRaw, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Select, Tabs } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import ContextPromptSection from './components/ContextPromptSection.vue';
import OneShotTab from './components/OneShotTab.vue';
import RewriteView from './components/RewriteView.vue';
import SessionTab from './components/SessionTab.vue';
import { useRewriteContext } from './composables/useRewriteContext';
import { useRewriteOneShot } from './composables/useRewriteOneShot';
import { useRewriteSessions } from './composables/useRewriteSessions';
import { useRewriteSettings } from './composables/useRewriteSettings';
import type { RewriteSettings, StructuredResponseFormat } from './types';

const props = defineProps<{
  api: ExtensionAPI<RewriteSettings>;
  originalText: string;
  identifier: string;
  referenceMessageIndex?: number;
  onApply: (text: string) => void;
  onCancel: () => void;
  closePopup?: () => void;
}>();

const t = props.api.i18n.t;

// UI State
const activeTab = ref<string>('one-shot');

// Use composables
const {
  selectedTemplateId,
  selectedProfile,
  promptOverride,
  contextMessageCount,
  escapeMacros,
  argOverrides,
  structuredResponseFormat,
  selectedContextLorebooks,
  selectedContextEntries,
  selectedContextCharacters,
  isCharacterContextOpen,
  isWorldInfoContextOpen,
  IS_WORLD_INFO_FIELD,
  templateOptions,
  currentTemplate,
  canResetPrompt,
  resetPrompt,
  saveState,
} = useRewriteSettings(props.api, props.identifier);

const {
  bookCache,
  selectedEntryContext,
  availableLorebooks,
  availableCharacters,
  getContextData,
  getContextMessagesString,
  getAdditionalCharactersContext,
  getWorldInfoContext,
} = useRewriteContext(props.api, props.identifier, selectedContextLorebooks, selectedContextEntries);

const {
  oneShotGeneratedText,
  isGenerating: oneShotIsGenerating,
  handleAbort: handleOneShotAbort,
  handleGenerateOneShot: generateOneShot,
  handleCopyOutput,
} = useRewriteOneShot(props.api);

const {
  sessions,
  activeSession,
  isGenerating: sessionIsGenerating,
  latestSessionText,
  refreshSessions,
  handleNewSession: newSession,
  handleLoadSession: loadSession,
  handleDeleteSession: deleteSession,
  handleSessionSend: sessionSend,
  handleSessionDeleteFrom: sessionDeleteFrom,
  handleEditMessage: editMessage,
  handleRegenerate: regenerate,
  handleAbort: handleSessionAbort,
} = useRewriteSessions(props.api);

const isGenerating = computed(() => oneShotIsGenerating.value || sessionIsGenerating.value);

const IGNORE_INPUT = computed(() => currentTemplate.value?.ignoreInput === true);

async function handleGenerateOneShot() {
  const contextMessagesStr = getContextMessagesString(contextMessageCount.value, props.referenceMessageIndex);
  const otherCharactersStr = getAdditionalCharactersContext(selectedContextCharacters.value);
  const worldInfoMacros = await getWorldInfoContext(selectedContextLorebooks.value, selectedContextEntries.value);
  const additionalMacros = {
    contextMessages: contextMessagesStr,
    fieldName: props.identifier,
    otherCharacters: otherCharactersStr,
    ...worldInfoMacros,
  };
  generateOneShot(
    props.originalText,
    selectedTemplateId.value,
    selectedProfile.value,
    promptOverride.value,
    getContextData(),
    additionalMacros,
    argOverrides.value,
    escapeMacros.value,
    t as (key: string) => string,
  );
}

async function handleNewSession() {
  const contextMessagesStr = getContextMessagesString(contextMessageCount.value, props.referenceMessageIndex);
  const otherCharactersStr = getAdditionalCharactersContext(selectedContextCharacters.value);
  const worldInfoMacros = await getWorldInfoContext(selectedContextLorebooks.value, selectedContextEntries.value);
  const additionalMacros = {
    contextMessages: contextMessagesStr,
    fieldName: props.identifier,
    otherCharacters: otherCharactersStr,
    ...worldInfoMacros,
  };
  newSession(
    selectedTemplateId.value,
    props.identifier,
    props.originalText,
    getContextData(),
    additionalMacros,
    argOverrides.value,
    t as (key: string) => string,
  );
}

function handleDeleteSession(id: string) {
  deleteSession(id, props.identifier);
}

function handleSend(text: string) {
  sessionSend(text, selectedProfile.value, structuredResponseFormat.value, t as (key: string) => string);
}

function handleRegenerate() {
  regenerate(selectedProfile.value, structuredResponseFormat.value, t as (key: string) => string);
}

function handleApply(text: string) {
  saveState();
  props.onApply(text);
  props.closePopup?.();
}

function handleApplyLatestSession() {
  if (latestSessionText.value) {
    handleApply(latestSessionText.value);
  }
}

function handleCancel() {
  props.onCancel();
  props.closePopup?.();
}

function handleCopy() {
  handleCopyOutput(t as (key: string) => string);
}

function openDiffPopup(original: string, modified: string) {
  props.api.ui
    .showPopup({
      title: t('extensionsBuiltin.rewrite.popup.diff'),
      component: markRaw(RewriteView),
      componentProps: {
        originalText: original,
        generatedText: modified,
        isGenerating: false,
        ignoreInput: false,
      },
      wide: true,
      large: true,
      customButtons: [
        {
          text: t('extensionsBuiltin.rewrite.popup.apply'),
          result: 1, // Positive result
          classes: ['btn-confirm'],
        },
        {
          text: t('common.close'),
          result: 0,
          classes: ['btn-ghost'],
        },
      ],
    })
    .then(({ result }) => {
      if (result === 1) {
        handleApply(modified);
      }
    });
}

onMounted(async () => {
  await refreshSessions(props.identifier);
});

watch(
  [
    selectedProfile,
    promptOverride,
    contextMessageCount,
    escapeMacros,
    structuredResponseFormat,
    isCharacterContextOpen,
    isWorldInfoContextOpen,
  ],
  () => {
    saveState();
  },
);

watch(
  [selectedContextLorebooks, selectedContextEntries, selectedContextCharacters, argOverrides],
  () => {
    saveState();
  },
  { deep: true },
);

function handleShowDiff(previous: string, current: string) {
  openDiffPopup(previous, current);
}

function handleGeneralDiff() {
  if (!activeSession.value) return;
  // Diff Original vs Latest
  openDiffPopup(props.originalText, latestSessionText.value);
}
</script>

<template>
  <div class="rewrite-popup-content">
    <div class="controls-row">
      <div style="flex: 1">
        <FormItem :label="t('extensionsBuiltin.rewrite.popup.template')">
          <Select v-model="selectedTemplateId" :options="templateOptions" />
        </FormItem>
      </div>
      <div style="flex: 1">
        <FormItem :label="t('extensionsBuiltin.rewrite.popup.connectionProfile')">
          <ConnectionProfileSelector v-model="selectedProfile" />
        </FormItem>
      </div>
    </div>

    <ContextPromptSection
      :api="api"
      :active-tab="activeTab"
      :current-template="currentTemplate"
      :arg-overrides="argOverrides"
      :escape-macros="escapeMacros"
      :context-message-count="contextMessageCount"
      :is-character-context-open="isCharacterContextOpen"
      :is-world-info-context-open="isWorldInfoContextOpen"
      :selected-context-characters="selectedContextCharacters"
      :selected-context-lorebooks="selectedContextLorebooks"
      :selected-context-entries="selectedContextEntries"
      :available-lorebooks="availableLorebooks"
      :available-characters="availableCharacters"
      :selected-entry-context="selectedEntryContext"
      :is-world-info-field="IS_WORLD_INFO_FIELD"
      :prompt-override="promptOverride"
      :structured-response-format="structuredResponseFormat"
      :can-reset-prompt="canResetPrompt"
      :book-cache="bookCache"
      @update:arg-overrides="argOverrides = $event"
      @update:escape-macros="escapeMacros = $event"
      @update:context-message-count="contextMessageCount = $event"
      @update:is-character-context-open="isCharacterContextOpen = $event"
      @update:is-world-info-context-open="isWorldInfoContextOpen = $event"
      @update:selected-context-characters="selectedContextCharacters = $event"
      @update:selected-context-lorebooks="selectedContextLorebooks = $event"
      @update:selected-context-entries="selectedContextEntries = $event"
      @update:prompt-override="promptOverride = $event"
      @update:structured-response-format="structuredResponseFormat = $event as StructuredResponseFormat"
      @reset-prompt="resetPrompt"
    />

    <!-- Tabs -->
    <Tabs
      v-model="activeTab"
      :options="[
        { label: t('extensionsBuiltin.rewrite.popup.oneShot'), value: 'one-shot', icon: 'fa-wand-magic-sparkles' },
        { label: t('extensionsBuiltin.rewrite.popup.sessions'), value: 'session', icon: 'fa-comments' },
      ]"
    />

    <div class="tab-content">
      <!-- One-Shot View -->
      <OneShotTab
        v-show="activeTab === 'one-shot'"
        :original-text="originalText"
        :one-shot-generated-text="oneShotGeneratedText"
        :is-generating="isGenerating"
        :ignore-input="!!IGNORE_INPUT"
        :api="api"
        @generate="handleGenerateOneShot"
        @abort="handleOneShotAbort"
        @cancel="handleCancel"
        @apply="handleApply"
        @copy-output="handleCopy"
      />

      <!-- Session View -->
      <SessionTab
        v-show="activeTab === 'session'"
        :api="api"
        :sessions="sessions"
        :active-session="activeSession"
        :is-generating="isGenerating"
        :original-text="originalText"
        :latest-session-text="latestSessionText"
        @new-session="handleNewSession"
        @load-session="loadSession"
        @delete-session="handleDeleteSession"
        @send="handleSend"
        @delete-from="sessionDeleteFrom"
        @edit-message="editMessage"
        @apply="handleApply"
        @show-diff="handleShowDiff"
        @abort="handleSessionAbort"
        @regenerate="handleRegenerate"
        @cancel="handleCancel"
        @apply-latest="handleApplyLatestSession"
        @general-diff="handleGeneralDiff"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.rewrite-popup-content {
  display: flex;
  flex-direction: column;
  gap: 15px;
  height: 100%;
}

.controls-row {
  display: flex;
  gap: 10px;
}

.tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
