<script setup lang="ts">
import { computed, isProxy, isReactive, isRef, markRaw, onMounted, ref, toRaw, watch } from 'vue';
import { ConnectionProfileSelector, SplitPane } from '../../../components/common';
import { Button, Checkbox, CollapsibleSection, FormItem, Input, Select, Tabs, Textarea } from '../../../components/UI';
import type { Character, ExtensionAPI, Persona, WorldInfoBook, WorldInfoHeader } from '../../../types';
import RewriteView from './components/RewriteView.vue';
import SessionManager from './components/SessionManager.vue';
import SessionView from './components/SessionView.vue';
import { RewriteService } from './RewriteService';
import {
  DEFAULT_TEMPLATES,
  type RewriteLLMResponse,
  type RewriteSession,
  type RewriteSettings,
  type RewriteTemplateOverride,
  type StructuredResponseFormat,
} from './types';

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
const service = new RewriteService(props.api);

// Settings State
const settings = ref<RewriteSettings>(
  props.api.settings.get() || {
    templates: [...DEFAULT_TEMPLATES],
    lastUsedTemplates: {},
    templateOverrides: {},
  },
);

// UI State
const activeTab = ref<string>('one-shot');
const selectedTemplateId = ref<string>('');
const selectedProfile = ref<string>('');
const promptOverride = ref<string>('');
const contextMessageCount = ref<number>(0);
const escapeMacros = ref<boolean>(true);
const argOverrides = ref<Record<string, boolean | number | string>>({});
const structuredResponseFormat = ref<StructuredResponseFormat>('native');

const selectedContextLorebooks = ref<string[]>([]);
const selectedContextEntries = ref<Record<string, number[]>>({});
const selectedContextCharacters = ref<string[]>([]);

// Data Cache
const allBookHeaders = ref<WorldInfoHeader[]>([]);
const bookCache = ref<Record<string, WorldInfoBook>>({});
const allCharacters = ref<Character[]>([]);

// Generation State (One-Shot)
const oneShotGeneratedText = ref<string>('');
const isGenerating = ref<boolean>(false);
const abortController = ref<AbortController | null>(null);

// Session State
const sessions = ref<RewriteSession[]>([]);
const activeSession = ref<RewriteSession | null>(null);

// Constants
const IS_CHARACTER_FIELD = computed(() => props.identifier.startsWith('character.'));
const IS_WORLD_INFO_FIELD = computed(() => props.identifier.startsWith('world_info.'));
const IGNORE_INPUT = computed(() => currentTemplate.value?.ignoreInput === true);

// Derived UI State for World Info
const selectedEntryContext = ref<{ bookName: string; entry: { uid: number; comment: string } } | null>(null);

onMounted(async () => {
  if (!settings.value.lastUsedTemplates) settings.value.lastUsedTemplates = {};
  if (!settings.value.templateOverrides) settings.value.templateOverrides = {};

  // Auto-select template
  const lastUsedTpl = settings.value.lastUsedTemplates[props.identifier];
  if (lastUsedTpl && settings.value.templates.find((t) => t.id === lastUsedTpl)) {
    selectedTemplateId.value = lastUsedTpl;
  } else {
    // Smart defaults
    if (IS_WORLD_INFO_FIELD.value) {
      const wiTpl = settings.value.templates.find((t) => t.id === 'world-info-refiner');
      if (wiTpl) selectedTemplateId.value = wiTpl.id;
    } else if (IS_CHARACTER_FIELD.value) {
      const charTpl = settings.value.templates.find((t) => t.id === 'character-polisher');
      if (charTpl) selectedTemplateId.value = charTpl.id;
    } else {
      if (settings.value.templates.length > 0) {
        selectedTemplateId.value = settings.value.templates[0].id;
      }
    }
  }

  loadTemplateOverrides();

  // Load world info data
  allBookHeaders.value = props.api.worldInfo.getAllBookNames();
  allCharacters.value = props.api.character.getAll();

  // Get current context if available
  const currentCtx = props.api.worldInfo.getSelectedEntry();
  if (currentCtx) {
    selectedEntryContext.value = {
      bookName: currentCtx.bookName,
      entry: {
        uid: currentCtx.entry.uid,
        comment: currentCtx.entry.comment,
      },
    };
  }

  // Ensure selected books are loaded
  for (const book of selectedContextLorebooks.value) {
    await ensureBookLoaded(book);
  }

  // Load Sessions
  await refreshSessions();
});

watch(selectedContextLorebooks, async (newBooks) => {
  for (const book of newBooks) {
    await ensureBookLoaded(book);
  }
  for (const key of Object.keys(selectedContextEntries.value)) {
    if (!newBooks.includes(key)) {
      delete selectedContextEntries.value[key];
    }
  }
});

async function ensureBookLoaded(bookName: string) {
  if (!bookCache.value[bookName]) {
    try {
      const book = await props.api.worldInfo.getBook(bookName);
      if (book) {
        bookCache.value[bookName] = book;
      }
    } catch (error) {
      console.error(`Failed to load book ${bookName}`, error);
    }
  }
}

const templateOptions = computed(() => {
  return settings.value.templates.map((t) => ({ label: t.name, value: t.id }));
});

const currentTemplate = computed(() => settings.value.templates.find((t) => t.id === selectedTemplateId.value));

const showWorldInfoContextSection = computed(() => {
  const arg = currentTemplate.value?.args?.find((a) => a.key === 'includeSelectedBookContext');
  if (!arg) return false;
  return !!argOverrides.value['includeSelectedBookContext'];
});

const showCharacterContextSection = computed(() => {
  const arg = currentTemplate.value?.args?.find((a) => a.key === 'includeSelectedCharacters');
  if (!arg) return false;
  return !!argOverrides.value['includeSelectedCharacters'];
});

const canResetPrompt = computed(() => {
  if (!currentTemplate.value) return false;
  return promptOverride.value !== currentTemplate.value.prompt;
});

const availableLorebooks = computed(() => {
  return allBookHeaders.value.map((b) => ({ label: b.name, value: b.name }));
});

const availableCharacters = computed(() => {
  let excludeAvatar = '';
  if (IS_CHARACTER_FIELD.value) {
    const editing = props.api.character.getEditing();
    if (editing) excludeAvatar = editing.avatar;
  }
  return allCharacters.value.filter((c) => c.avatar !== excludeAvatar).map((c) => ({ label: c.name, value: c.avatar }));
});

function getEntriesForBook(bookName: string) {
  const book = bookCache.value[bookName];
  if (!book) return [];
  return book.entries.map((e) => ({
    label: `${e.uid}: ${e.comment || '(No Title)'}`,
    value: e.uid,
  }));
}

function loadTemplateOverrides() {
  const tplId = selectedTemplateId.value;
  if (!tplId) return;

  const overrides = settings.value.templateOverrides[tplId] || {};
  const tpl = settings.value.templates.find((t) => t.id === tplId);

  selectedProfile.value = overrides.lastUsedProfile || settings.value.defaultConnectionProfile || '';
  promptOverride.value = overrides.prompt ?? tpl?.prompt ?? '';
  contextMessageCount.value = overrides.lastUsedXMessages ?? 0;
  escapeMacros.value = overrides.escapeInputMacros ?? true;
  selectedContextLorebooks.value = overrides.selectedContextLorebooks || [];
  selectedContextEntries.value = overrides.selectedContextEntries ? { ...overrides.selectedContextEntries } : {};
  selectedContextCharacters.value = overrides.selectedContextCharacters || [];
  structuredResponseFormat.value = overrides.structuredResponseFormat || 'native';

  const args: Record<string, boolean | number | string> = {};
  if (tpl?.args) {
    tpl.args.forEach((arg) => {
      args[arg.key] = overrides.args?.[arg.key] ?? arg.defaultValue;
    });
  }
  argOverrides.value = args;
}

function resetPrompt() {
  if (currentTemplate.value) {
    promptOverride.value = currentTemplate.value.prompt;
  }
}

function saveState() {
  const tplId = selectedTemplateId.value;
  if (!tplId) return;

  settings.value.lastUsedTemplates[props.identifier] = tplId;

  const overrides: RewriteTemplateOverride = {
    lastUsedProfile: selectedProfile.value,
    prompt: promptOverride.value,
    lastUsedXMessages: Number(contextMessageCount.value),
    escapeInputMacros: escapeMacros.value,
    args: argOverrides.value,
    selectedContextLorebooks: selectedContextLorebooks.value,
    selectedContextEntries: { ...selectedContextEntries.value },
    selectedContextCharacters: selectedContextCharacters.value,
    structuredResponseFormat: structuredResponseFormat.value,
  };

  settings.value.templateOverrides[tplId] = overrides;

  props.api.settings.set(undefined, settings.value);
  props.api.settings.save();
}

watch(selectedTemplateId, () => {
  loadTemplateOverrides();
});

// --- One-Shot Generation ---

function getContextData() {
  let activeCharacter: Character | undefined;
  const persona: Persona | undefined = props.api.persona.getActive() || undefined;

  if (IS_CHARACTER_FIELD.value) {
    activeCharacter = props.api.character.getEditing() || undefined;
  } else {
    const actives = props.api.character.getActives();
    if (actives.length > 0) activeCharacter = actives[0];
  }
  return { activeCharacter, persona };
}

function getContextMessagesString(): string {
  if (contextMessageCount.value <= 0) return '';
  const history = props.api.chat.getHistory();
  if (history.length === 0) return '';
  const endIndex = props.referenceMessageIndex !== undefined ? props.referenceMessageIndex : history.length;
  const startIndex = Math.max(0, endIndex - contextMessageCount.value);
  const slice = history.slice(startIndex, endIndex);
  return slice.map((m) => `${m.name}: ${m.mes}`).join('\n');
}

function getAdditionalCharactersContext(): string {
  if (selectedContextCharacters.value.length === 0) return '';
  const chars = selectedContextCharacters.value
    .map((avatar) => props.api.character.get(avatar))
    .filter((c) => c !== null) as Character[];
  return chars
    .map((c) => {
      let text = `Name: ${c.name}`;
      if (c.description) text += `\nDescription: ${c.description}`;
      if (c.personality) text += `\nPersonality: ${c.personality}`;
      if (c.scenario) text += `\nScenario: ${c.scenario}`;
      if (c.mes_example) text += `\nExample Messages: ${c.mes_example}`;
      return text;
    })
    .join('\n\n');
}

async function getWorldInfoContext() {
  const macros: Record<string, unknown> = {};
  const currentFilename = props.api.worldInfo.getSelectedBookName();
  let currentBookUid: number | null = null;
  let currentBookName: string | null = null;

  if (currentFilename) {
    macros.selectedBook = { name: currentFilename };
    currentBookName = currentFilename;
  }

  const currentEntryCtx = props.api.worldInfo.getSelectedEntry();
  if (currentEntryCtx) {
    macros.selectedEntry = {
      uid: currentEntryCtx.entry.uid,
      key: currentEntryCtx.entry.key.join(', '),
      comment: currentEntryCtx.entry.comment,
      content: currentEntryCtx.entry.content,
    };
    currentBookUid = currentEntryCtx.entry.uid;
    currentBookName = currentEntryCtx.bookName;
  }

  if (selectedContextLorebooks.value.length > 0) {
    const otherBooksContent: string[] = [];
    for (const bookName of selectedContextLorebooks.value) {
      await ensureBookLoaded(bookName);
      const book = bookCache.value[bookName];
      if (book) {
        const entryIds = selectedContextEntries.value[bookName] || [];
        let entriesToInclude = book.entries;
        if (entryIds.length > 0) {
          entriesToInclude = book.entries.filter((e) => entryIds.includes(e.uid));
        }
        if (currentBookName === bookName && currentBookUid !== null) {
          entriesToInclude = entriesToInclude.filter((e) => e.uid !== currentBookUid);
        }
        if (entriesToInclude.length > 0) {
          const entriesSummary = entriesToInclude
            .map((e) => `- [${e.uid}] Keys: ${e.key.join(', ')} | Comment: ${e.comment}\n  Content: ${e.content}`)
            .join('\n');
          otherBooksContent.push(`Book: ${book.name}\n${entriesSummary}`);
        }
      }
    }
    macros.otherWorldInfo = otherBooksContent.join('\n\n');
  }
  return macros;
}

function handleAbort() {
  if (abortController.value) {
    abortController.value.abort();
    abortController.value = null;
  }
}

async function handleGenerateOneShot() {
  if (!selectedProfile.value) {
    props.api.ui.showToast(t('extensionsBuiltin.rewrite.errors.selectProfile'), 'error');
    return;
  }
  saveState();
  isGenerating.value = true;
  abortController.value = new AbortController();
  oneShotGeneratedText.value = '';

  try {
    const contextData = getContextData();
    const contextMessagesStr = getContextMessagesString();
    const worldInfoMacros = await getWorldInfoContext();
    const otherCharactersStr = getAdditionalCharactersContext();

    let inputToProcess = props.originalText;
    let promptToUse = promptOverride.value;
    if (escapeMacros.value) {
      inputToProcess = `{{#raw}}${props.originalText}{{/raw}}`;
      promptToUse = `{{#raw}}${promptOverride.value}{{/raw}}`;
    }

    const response = await service.generateRewrite(
      inputToProcess,
      selectedTemplateId.value,
      selectedProfile.value,
      promptToUse,
      contextData,
      {
        contextMessages: contextMessagesStr,
        fieldName: props.identifier,
        otherCharacters: otherCharactersStr,
        ...worldInfoMacros,
      },
      argOverrides.value,
      abortController.value?.signal,
    );

    if (Symbol.asyncIterator in response) {
      let rawAcc = '';
      for await (const chunk of response) {
        rawAcc += chunk.delta;
        oneShotGeneratedText.value = service.extractCodeBlock(rawAcc);
      }
    } else {
      oneShotGeneratedText.value = service.extractCodeBlock(response.content);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error(error);
    if (error?.name === 'AbortError' || error?.message?.includes('abort')) {
      props.api.ui.showToast(t('extensionsBuiltin.rewrite.messages.generationAborted'), 'info');
    } else {
      props.api.ui.showToast(t('extensionsBuiltin.rewrite.messages.generationFailed'), 'error');
    }
  } finally {
    isGenerating.value = false;
    abortController.value = null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepToRaw<T extends Record<string, any>>(sourceObj: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const objectIterator = (input: any): any => {
    if (Array.isArray(input)) {
      return input.map((item) => objectIterator(item));
    }
    if (isRef(input) || isReactive(input) || isProxy(input)) {
      return objectIterator(toRaw(input));
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

// --- Session Logic ---

async function refreshSessions() {
  sessions.value = await service.getSessions(props.identifier);
}

async function handleNewSession() {
  saveState();
  try {
    const contextData = getContextData();
    const contextMessagesStr = getContextMessagesString();
    const worldInfoMacros = await getWorldInfoContext();
    const otherCharactersStr = getAdditionalCharactersContext();

    const additionalMacros = {
      contextMessages: contextMessagesStr,
      fieldName: props.identifier,
      otherCharacters: otherCharactersStr,
      ...worldInfoMacros,
    };

    activeSession.value = await service.createSession(
      selectedTemplateId.value,
      props.identifier,
      props.originalText,
      contextData,
      additionalMacros,
      argOverrides.value,
    );
    await refreshSessions();
  } catch (e) {
    console.error(e);
    props.api.ui.showToast(t('extensionsBuiltin.rewrite.session.createFailed'), 'error');
  }
}

async function handleLoadSession(id: string) {
  activeSession.value = await service.getSession(id);
}

async function handleDeleteSession(id: string) {
  await service.deleteSession(id);
  if (activeSession.value?.id === id) {
    activeSession.value = null;
  }
  await refreshSessions();
}

async function handleSessionSend(text: string) {
  if (!activeSession.value || !selectedProfile.value) return;

  isGenerating.value = true;
  abortController.value = new AbortController();

  // Add User Message
  activeSession.value.messages.push({
    id: props.api.uuid(),
    role: 'user',
    content: text,
    timestamp: Date.now(),
  });
  await service.saveSession(deepToRaw(activeSession.value));

  try {
    const response = await service.generateSessionResponse(
      activeSession.value.messages,
      selectedProfile.value,
      structuredResponseFormat.value,
      abortController.value?.signal,
    );

    const previousState = props.originalText; // Simplified diff reference

    activeSession.value.messages.push({
      id: props.api.uuid(),
      role: 'assistant',
      content: response,
      timestamp: Date.now(),
      previousTextState: previousState,
    });

    await service.saveSession(deepToRaw(activeSession.value));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error(error);
    if (error?.name === 'AbortError') {
      props.api.ui.showToast(t('extensionsBuiltin.rewrite.messages.generationAborted'), 'info');
    } else {
      props.api.ui.showToast(t('extensionsBuiltin.rewrite.messages.generationFailed') + ': ' + error.message, 'error');
    }
  } finally {
    isGenerating.value = false;
    abortController.value = null;
  }
}

async function handleSessionDeleteFrom(msgId: string) {
  if (!activeSession.value) return;
  const index = activeSession.value.messages.findIndex((m) => m.id === msgId);
  if (index !== -1) {
    activeSession.value.messages = activeSession.value.messages.slice(0, index);
    await service.saveSession(deepToRaw(activeSession.value));
  }
}

// --- Common ---

function handleApply(text: string) {
  saveState();
  props.onApply(text);
  props.closePopup?.();
}

function handleCancel() {
  props.onCancel();
  props.closePopup?.();
}

function handleCopyOutput() {
  if (!oneShotGeneratedText.value) return;
  navigator.clipboard.writeText(oneShotGeneratedText.value).then(
    () => props.api.ui.showToast(t('extensionsBuiltin.rewrite.messages.copiedToClipboard'), 'success'),
    () => props.api.ui.showToast(t('extensionsBuiltin.rewrite.messages.copyFailed'), 'error'),
  );
}

// --- Diff Logic ---

const latestSessionText = computed(() => {
  if (!activeSession.value || activeSession.value.messages.length === 0) return '';
  const lastMsg = activeSession.value.messages
    .slice()
    .reverse()
    .find((m) => m.role === 'assistant');
  if (!lastMsg) return '';

  const content = lastMsg.content;
  if (typeof content === 'string') return content;
  return (content as RewriteLLMResponse).response;
});

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
        // Pass copy logic if needed, but the view handles event emit which we can't catch easily unless we wrap or use componentProps callbacks?
        // Since RewriteView emits 'copy-output', and showPopup doesn't automatically wire emits, we lose that unless we wrap.
        // But for basic diff viewing, it's fine.
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

    <CollapsibleSection :title="t('extensionsBuiltin.rewrite.popup.contextPrompt')" :is-open="true">
      <!-- Dynamic Arguments -->
      <div v-if="currentTemplate?.args && currentTemplate.args.length > 0" class="dynamic-args-grid">
        <div v-for="arg in currentTemplate.args" :key="arg.key" class="dynamic-arg-item">
          <Checkbox v-if="arg.type === 'boolean'" v-model="argOverrides[arg.key] as boolean" :label="arg.label" />
          <FormItem v-else :label="arg.label">
            <Input
              v-model="argOverrides[arg.key] as string | number"
              :type="arg.type === 'number' ? 'number' : 'text'"
            />
          </FormItem>
        </div>
      </div>

      <div class="context-controls">
        <div v-if="!currentTemplate?.ignoreInput && activeTab === 'one-shot'" class="escape-control">
          <Checkbox
            v-model="escapeMacros"
            :label="t('extensionsBuiltin.rewrite.popup.escapeMacros')"
            :title="t('extensionsBuiltin.rewrite.popup.escapeMacrosHint')"
          />
        </div>
        <div class="flex-spacer"></div>
        <div class="msg-count-control">
          <span class="label">{{ t('extensionsBuiltin.rewrite.popup.contextMessages') }}</span>
          <Input v-model="contextMessageCount" type="number" :min="0" />
        </div>
      </div>

      <!-- Character Context -->
      <CollapsibleSection
        v-if="showCharacterContextSection"
        class="inner-collapsible"
        :title="t('extensionsBuiltin.rewrite.popup.relatedCharacters')"
        :is-open="false"
      >
        <FormItem
          :label="t('extensionsBuiltin.rewrite.popup.contextCharacters')"
          :description="t('extensionsBuiltin.rewrite.popup.contextCharactersDesc')"
          class="character-select"
        >
          <Select
            v-model="selectedContextCharacters"
            :options="availableCharacters"
            multiple
            :placeholder="t('common.select')"
          />
        </FormItem>
      </CollapsibleSection>

      <!-- World Info Context -->
      <CollapsibleSection
        v-if="showWorldInfoContextSection"
        class="inner-collapsible"
        :title="t('extensionsBuiltin.rewrite.popup.worldInfoContext')"
        :is-open="false"
      >
        <div v-if="selectedEntryContext && IS_WORLD_INFO_FIELD" class="current-context-info">
          {{ t('extensionsBuiltin.rewrite.popup.currentEntry') }}:
          <strong>{{ selectedEntryContext.entry.comment }}</strong> (ID: {{ selectedEntryContext.entry.uid }})
        </div>

        <FormItem
          :label="t('extensionsBuiltin.rewrite.popup.contextLorebooks')"
          :description="t('extensionsBuiltin.rewrite.popup.contextLorebooksDesc')"
          class="lorebook-select"
        >
          <Select
            v-model="selectedContextLorebooks"
            :options="availableLorebooks"
            multiple
            :placeholder="t('common.select')"
          />
        </FormItem>

        <div v-if="selectedContextLorebooks.length > 0" class="book-entries-selection">
          <div v-for="bookName in selectedContextLorebooks" :key="bookName" class="book-entry-row">
            <div class="book-label">{{ bookName }}</div>
            <div class="entries-select">
              <Select
                v-model="selectedContextEntries[bookName]"
                :options="getEntriesForBook(bookName)"
                multiple
                :placeholder="t('extensionsBuiltin.rewrite.popup.allEntries')"
              />
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <!-- One-Shot Prompt Override -->
      <FormItem v-if="activeTab === 'one-shot'" :label="t('extensionsBuiltin.rewrite.popup.instruction')">
        <div class="input-with-reset">
          <Textarea v-model="promptOverride" :rows="2" allow-maximize />
          <Button
            v-if="canResetPrompt"
            class="reset-btn"
            icon="fa-rotate-left"
            variant="ghost"
            :title="t('extensionsBuiltin.rewrite.settings.resetToDefault')"
            @click="resetPrompt"
          />
        </div>
      </FormItem>

      <!-- Session Mode Settings -->
      <div v-if="activeTab === 'session'" class="session-settings">
        <FormItem :label="t('extensionsBuiltin.rewrite.popup.structuredResponseFormat')">
          <Select
            v-model="structuredResponseFormat"
            :options="[
              { label: 'Native', value: 'native' },
              { label: 'JSON', value: 'json' },
              { label: 'XML', value: 'xml' },
            ]"
          />
        </FormItem>
      </div>
    </CollapsibleSection>

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
      <div v-show="activeTab === 'one-shot'" class="view-container">
        <RewriteView
          :original-text="originalText"
          :generated-text="oneShotGeneratedText"
          :is-generating="isGenerating"
          :ignore-input="!!IGNORE_INPUT"
          @copy-output="handleCopyOutput"
        />

        <div class="actions-row">
          <Button v-if="!isGenerating" @click="handleGenerateOneShot">
            {{ t('extensionsBuiltin.rewrite.popup.generate') }}
          </Button>
          <Button v-else variant="danger" @click="handleAbort">
            {{ t('extensionsBuiltin.rewrite.popup.abort') }}
          </Button>
          <div class="spacer"></div>
          <Button variant="ghost" @click="handleCancel">{{ t('common.cancel') }}</Button>
          <Button
            variant="confirm"
            :disabled="!oneShotGeneratedText || isGenerating"
            @click="handleApply(oneShotGeneratedText)"
            >{{ t('extensionsBuiltin.rewrite.popup.apply') }}</Button
          >
        </div>
      </div>

      <!-- Session View -->
      <div v-show="activeTab === 'session'" class="view-container session-mode">
        <SplitPane :initial-width="250" :min-width="200" :max-width="400">
          <template #side>
            <div class="session-sidebar">
              <SessionManager
                :sessions="sessions"
                :current-session-id="activeSession?.id"
                @new-session="handleNewSession"
                @load-session="handleLoadSession"
                @delete-session="handleDeleteSession"
              />
            </div>
          </template>
          <template #main>
            <div class="session-main">
              <div v-if="activeSession" class="session-header-controls">
                <Button
                  icon="fa-code-compare"
                  :title="t('extensionsBuiltin.rewrite.popup.generalDiff')"
                  :disabled="!latestSessionText"
                  @click="handleGeneralDiff"
                >
                  {{ t('extensionsBuiltin.rewrite.popup.diff') }}
                </Button>
              </div>

              <SessionView
                v-if="activeSession"
                :messages="activeSession.messages"
                :is-generating="isGenerating"
                :current-text="originalText"
                @send="handleSessionSend"
                @delete-from="handleSessionDeleteFrom"
                @apply-text="handleApply"
                @show-diff="handleShowDiff"
                @abort="handleAbort"
              />
              <div v-else class="empty-session-view">
                <p>{{ t('extensionsBuiltin.rewrite.session.selectSession') }}</p>
                <Button icon="fa-plus" @click="handleNewSession">{{
                  t('extensionsBuiltin.rewrite.session.newSession')
                }}</Button>
              </div>

              <!-- Close button for Session Tab -->
              <div class="session-footer">
                <div class="spacer"></div>
                <Button variant="ghost" @click="handleCancel">{{ t('common.close') }}</Button>
              </div>
            </div>
          </template>
        </SplitPane>
      </div>
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

.context-controls {
  display: flex;
  gap: 15px;
  align-items: center;
  margin-bottom: 10px;
}

.dynamic-args-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 15px;
  padding-bottom: 15px;
  border-bottom: 1px dashed var(--theme-border-color);
}

.flex-spacer {
  flex: 1;
}

.msg-count-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
}

.escape-control {
  display: flex;
  align-items: center;
}

.input-with-reset {
  position: relative;
  display: flex;
}
.reset-btn {
  margin-left: 5px;
  height: auto;
  align-self: flex-start;
}

.inner-collapsible {
  margin-bottom: 15px;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: 5px;
  background-color: var(--black-20a);
}

.current-context-info {
  font-size: 0.85em;
  opacity: 0.8;
  margin-top: 5px;
  margin-bottom: 10px;
  padding: 5px;
  border-bottom: 1px solid var(--theme-border-color);
}

.lorebook-select,
.character-select {
  margin-bottom: 10px;
}

.book-entries-selection {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 5px;
  border-top: 1px dashed var(--theme-border-color);
}

.book-entry-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.book-label {
  width: 120px;
  font-size: 0.9em;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entries-select {
  flex: 1;
}

.session-settings {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--theme-border-color);
}

.tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.view-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;

  &.session-mode {
    flex-direction: row;
    border: 1px solid var(--theme-border-color);
    border-radius: var(--base-border-radius);
    background-color: var(--black-10a);
  }
}

.session-sidebar {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 5px;
}

.session-main {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 10px;
  padding: 10px;
}

.session-header-controls {
  display: flex;
  justify-content: flex-end;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--theme-border-color);
}

.session-footer {
  display: flex;
  margin-top: 5px;
}

.empty-session-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 15px;
  opacity: 0.6;
  border: 1px dashed var(--theme-border-color);
  border-radius: var(--base-border-radius);
}

.actions-row {
  display: flex;
  gap: 10px;
  margin-top: auto;
}

.spacer {
  flex: 1;
}
</style>
