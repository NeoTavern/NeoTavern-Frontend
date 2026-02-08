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
import type { FieldChange, RewriteField, RewriteSettings, StructuredResponseFormat } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepToRaw<T extends Record<string, any>>(sourceObj: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const objectIterator = (input: any): any => {
    if (Array.isArray(input)) {
      return input.map((item) => objectIterator(item));
    }
    if (input && typeof input === 'object') {
      return Object.keys(input).reduce((acc, key) => {
        acc[key as keyof typeof acc] = objectIterator(input[key]);
        return acc;
      }, {} as T);
    }
    return input;
  };

  return objectIterator(sourceObj);
}

const props = defineProps<{
  api: ExtensionAPI<RewriteSettings>;
  initialFields: RewriteField[];
  identifier: string;
  referenceMessageIndex?: number;
  onApply: (changes: FieldChange[]) => void;
  onCancel: () => void;
  closePopup?: () => void;
}>();

const t = props.api.i18n.t;

// Clone reactive props to plain objects
const safeInitialFields = computed(() => deepToRaw(props.initialFields));

// UI State
const isMultiFieldMode = computed(() => safeInitialFields.value.length > 1);
const activeTab = ref<string>(isMultiFieldMode.value ? 'session' : 'one-shot');
const primaryField = computed(() => safeInitialFields.value[0] || { id: '', label: '', value: '' });
const originalText = computed(() => primaryField.value.value);

const isGlobalCharacterEdit = computed(() => props.identifier.startsWith('character.global.'));

const tabOptions = computed(() => {
  const base = [{ label: t('extensionsBuiltin.rewrite.popup.sessions'), value: 'session', icon: 'fa-comments' }];
  if (!isGlobalCharacterEdit.value) {
    base.unshift({
      label: t('extensionsBuiltin.rewrite.popup.oneShot'),
      value: 'one-shot',
      icon: 'fa-wand-magic-sparkles',
    });
  }
  return base;
});

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
  latestSessionChanges,
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

async function handleGenerateOneShot(lastAssistantMessage?: string) {
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
    originalText.value,
    selectedTemplateId.value,
    selectedProfile.value,
    promptOverride.value,
    getContextData(),
    additionalMacros,
    argOverrides.value,
    escapeMacros.value,
    t as (key: string) => string,
    lastAssistantMessage,
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
    safeInitialFields.value,
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
  sessionSend(
    text,
    selectedProfile.value,
    structuredResponseFormat.value,
    safeInitialFields.value,
    t as (key: string) => string,
  );
}

function handleRegenerate() {
  regenerate(
    selectedProfile.value,
    structuredResponseFormat.value,
    safeInitialFields.value,
    t as (key: string) => string,
  );
}

function handleApply(changes: FieldChange[]) {
  saveState();
  props.onApply(changes);
  props.closePopup?.();
}

function handleApplyOneShot() {
  const change: FieldChange = {
    fieldId: primaryField.value.id,
    label: primaryField.value.label,
    oldValue: primaryField.value.value,
    newValue: oneShotGeneratedText.value,
  };
  handleApply([change]);
}

async function handleContinue() {
  if (!oneShotGeneratedText.value) return;
  await handleGenerateOneShot(oneShotGeneratedText.value);
}

function handleApplyLatestSession() {
  if (latestSessionChanges.value.length > 0) {
    handleApply(latestSessionChanges.value);
  }
}

function handleCancel() {
  props.onCancel();
  props.closePopup?.();
}

function handleCopy() {
  handleCopyOutput(t as (key: string) => string);
}

function openDiffPopup(changes: FieldChange[]) {
  props.api.ui.showPopup({
    title: t('extensionsBuiltin.rewrite.popup.diff'),
    component: markRaw(RewriteView),
    componentProps: {
      changes,
      isGenerating: false,
      ignoreInput: false,
    },
    wide: true,
    large: true,
    okButton: false,
    cancelButton: true,
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

function handleShowDiff(changes: FieldChange[]) {
  openDiffPopup(changes);
}

function handleGeneralDiff() {
  if (!activeSession.value) return;
  const changes = latestSessionChanges.value;
  if (changes.length > 0) {
    handleShowDiff(changes);
  }
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
    <Tabs v-model="activeTab" :options="tabOptions" />

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
        @apply="handleApplyOneShot"
        @copy-output="handleCopy"
        @continue="handleContinue"
      />

      <!-- Session View -->
      <SessionTab
        v-show="activeTab === 'session'"
        :api="api"
        :sessions="sessions"
        :active-session="activeSession"
        :is-generating="isGenerating"
        :initial-fields="safeInitialFields"
        :latest-session-changes="latestSessionChanges"
        @new-session="handleNewSession"
        @load-session="loadSession"
        @delete-session="handleDeleteSession"
        @send="handleSend"
        @delete-from="sessionDeleteFrom"
        @edit-message="editMessage"
        @apply-changes="handleApply"
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
