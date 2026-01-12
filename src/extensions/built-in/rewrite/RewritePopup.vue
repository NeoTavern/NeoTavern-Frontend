<script setup lang="ts">
import * as Diff from 'diff';
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { Button, Checkbox, CollapsibleSection, FormItem, Input, Select, Textarea } from '../../../components/UI';
import type { Character, ExtensionAPI, Persona, WorldInfoBook, WorldInfoHeader } from '../../../types';
import { RewriteService } from './RewriteService';
import { DEFAULT_TEMPLATES, type RewriteSettings, type RewriteTemplateOverride } from './types';

const props = defineProps<{
  api: ExtensionAPI<RewriteSettings>;
  originalText: string;
  identifier: string;
  referenceMessageIndex?: number;
  onApply: (text: string) => void;
  onCancel: () => void;
  closePopup?: () => void;
}>();

// TODO: i18n

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
const selectedTemplateId = ref<string>('');
const selectedProfile = ref<string>('');
const promptOverride = ref<string>('');
const contextMessageCount = ref<number>(0);
const escapeMacros = ref<boolean>(true);
const argOverrides = ref<Record<string, boolean | number | string>>({});

const selectedContextLorebooks = ref<string[]>([]);
const selectedContextEntries = ref<Record<string, number[]>>({});

const selectedContextCharacters = ref<string[]>([]);

// Data Cache
const allBookHeaders = ref<WorldInfoHeader[]>([]);
const bookCache = ref<Record<string, WorldInfoBook>>({});
const allCharacters = ref<Character[]>([]);

// Generation State
const generatedText = ref<string>('');
const isGenerating = ref<boolean>(false);
const abortController = ref<AbortController | null>(null);

// Diff State
const leftHtml = ref<string>('');
const rightHtml = ref<string>('');
const leftPaneRef = ref<HTMLElement | null>(null);
const rightPaneRef = ref<HTMLElement | null>(null);

// Constants
const IS_CHARACTER_FIELD = computed(() => props.identifier.startsWith('character.'));
const IS_WORLD_INFO_FIELD = computed(() => props.identifier.startsWith('world_info.'));
const IGNORE_INPUT = computed(() => currentTemplate.value?.ignoreInput === true);

// Derived UI State for World Info
const selectedEntryContext = ref<{ bookName: string; entry: { uid: number; comment: string } } | null>(null);

onMounted(async () => {
  if (!settings.value.lastUsedTemplates) settings.value.lastUsedTemplates = {};
  if (!settings.value.templateOverrides) settings.value.templateOverrides = {};

  // Auto-select template based on field type if no history
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
  updateDiff();

  // Load world info data if needed
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

  // Ensure selected books are loaded for entry options
  for (const book of selectedContextLorebooks.value) {
    await ensureBookLoaded(book);
  }
});

watch(selectedContextLorebooks, async (newBooks) => {
  // Fetch newly selected books for entry options
  for (const book of newBooks) {
    await ensureBookLoaded(book);
  }
  // Cleanup entries for deselected books
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
  // If editing a character field, exclude that character to prevent duplication/confusion
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

  if (overrides.lastUsedProfile) {
    selectedProfile.value = overrides.lastUsedProfile;
  } else {
    selectedProfile.value = settings.value.defaultConnectionProfile || '';
  }

  promptOverride.value = overrides.prompt ?? tpl?.prompt ?? '';
  contextMessageCount.value = overrides.lastUsedXMessages ?? 0;
  escapeMacros.value = overrides.escapeInputMacros ?? true;
  selectedContextLorebooks.value = overrides.selectedContextLorebooks || [];
  selectedContextEntries.value = overrides.selectedContextEntries ? { ...overrides.selectedContextEntries } : {};
  selectedContextCharacters.value = overrides.selectedContextCharacters || [];

  // Load args
  const args: Record<string, boolean | number | string> = {};
  if (tpl?.args) {
    tpl.args.forEach((arg) => {
      // Priority: Override > Default
      if (overrides.args && overrides.args[arg.key] !== undefined) {
        args[arg.key] = overrides.args[arg.key];
      } else {
        args[arg.key] = arg.defaultValue;
      }
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
  };

  settings.value.templateOverrides[tplId] = overrides;

  props.api.settings.set(undefined, settings.value);
  props.api.settings.save();
}

watch(selectedTemplateId, () => {
  loadTemplateOverrides();
});

// --- Diff Logic ---

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateDiff() {
  if (!generatedText.value) {
    leftHtml.value = escapeHtml(props.originalText);
    rightHtml.value = '';
    return;
  }

  if (IGNORE_INPUT.value) {
    rightHtml.value = escapeHtml(generatedText.value);
    return;
  }

  const diff = Diff.diffWords(props.originalText, generatedText.value);

  let lHtml = '';
  let rHtml = '';

  diff.forEach((part) => {
    const escapedVal = escapeHtml(part.value);

    if (part.removed) {
      lHtml += `<span class="diff-del">${escapedVal}</span>`;
    } else if (part.added) {
      rHtml += `<span class="diff-ins">${escapedVal}</span>`;
    } else {
      lHtml += escapedVal;
      rHtml += escapedVal;
    }
  });

  leftHtml.value = lHtml;
  rightHtml.value = rHtml;
}

// --- Scroll Sync ---
let isSyncingLeft = false;
let isSyncingRight = false;

function onLeftScroll() {
  if (!leftPaneRef.value || !rightPaneRef.value) return;
  if (isSyncingLeft) {
    isSyncingLeft = false;
    return;
  }
  isSyncingRight = true;
  rightPaneRef.value.scrollTop = leftPaneRef.value.scrollTop;
  rightPaneRef.value.scrollLeft = leftPaneRef.value.scrollLeft;
}

function onRightScroll() {
  if (!leftPaneRef.value || !rightPaneRef.value) return;
  if (isSyncingRight) {
    isSyncingRight = false;
    return;
  }
  isSyncingLeft = true;
  leftPaneRef.value.scrollTop = rightPaneRef.value.scrollTop;
  leftPaneRef.value.scrollLeft = rightPaneRef.value.scrollLeft;
}

// --- Generation Logic ---

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

  // 1. Current Selected Book & Entry
  const currentFilename = props.api.worldInfo.getSelectedBookName();
  let currentBookUid: number | null = null;
  let currentBookName: string | null = null;

  if (currentFilename) {
    // We try to get book info, might need to fetch if not in cache (though getSelectedBookName implies we know it)
    // We don't necessarily need the whole book content just for the name, but for consistency:
    macros.selectedBook = {
      name: currentFilename,
    };
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

  // 2. Additional Selected Lorebooks
  if (selectedContextLorebooks.value.length > 0) {
    const otherBooksContent: string[] = [];

    for (const bookName of selectedContextLorebooks.value) {
      // Ensure book is loaded (should be from mount/watch)
      await ensureBookLoaded(bookName);
      const book = bookCache.value[bookName];

      if (book) {
        const entryIds = selectedContextEntries.value[bookName] || [];
        let entriesToInclude = book.entries;

        if (entryIds.length > 0) {
          // Include only specifically selected entries
          entriesToInclude = book.entries.filter((e) => entryIds.includes(e.uid));
        }

        // If this is the book containing the currently edited entry, exclude that entry from "otherWorldInfo"
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

async function handleGenerate() {
  if (!selectedProfile.value) {
    props.api.ui.showToast(t('extensionsBuiltin.rewrite.errors.selectProfile'), 'error');
    return;
  }

  saveState();

  isGenerating.value = true;
  abortController.value = new AbortController();
  generatedText.value = '';
  if (!IGNORE_INPUT.value) {
    leftHtml.value = escapeHtml(props.originalText);
  }
  rightHtml.value = '';

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

    if (typeof response === 'function') {
      const generator = response();
      let rawAcc = '';
      for await (const chunk of generator) {
        rawAcc += chunk.delta;
        generatedText.value = service.extractCodeBlock(rawAcc);
        updateDiff();
      }
    } else {
      generatedText.value = service.extractCodeBlock(response.content);
      updateDiff();
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

function handleApply() {
  saveState();
  props.onApply(generatedText.value);
  props.closePopup?.();
}

function handleCancel() {
  props.onCancel();
  props.closePopup?.();
}

function handleCopyOutput() {
  if (!generatedText.value) return;

  navigator.clipboard.writeText(generatedText.value).then(
    () => {
      props.api.ui.showToast(t('extensionsBuiltin.rewrite.messages.copiedToClipboard'), 'success');
    },
    () => {
      props.api.ui.showToast(t('extensionsBuiltin.rewrite.messages.copyFailed'), 'error');
    },
  );
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
      <!-- Dynamic Arguments Section -->
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
        <div v-if="!currentTemplate?.ignoreInput" class="escape-control">
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

      <!-- Character Context Section -->
      <CollapsibleSection
        v-if="showCharacterContextSection"
        class="inner-collapsible"
        title="Related Characters"
        :is-open="false"
      >
        <FormItem
          label="Context Characters"
          description="Select additional characters to include in the context."
          class="character-select"
        >
          <Select
            v-model="selectedContextCharacters"
            :options="availableCharacters"
            multiple
            placeholder="Select characters..."
          />
        </FormItem>
      </CollapsibleSection>

      <!-- World Info Context Section -->
      <CollapsibleSection
        v-if="showWorldInfoContextSection"
        class="inner-collapsible"
        title="World Info Context"
        :is-open="false"
      >
        <div v-if="selectedEntryContext && IS_WORLD_INFO_FIELD" class="current-context-info">
          Current Entry: <strong>{{ selectedEntryContext.entry.comment }}</strong> (ID:
          {{ selectedEntryContext.entry.uid }})
        </div>

        <FormItem
          label="Context Lorebooks"
          description="Select additional lorebooks to include in the context."
          class="lorebook-select"
        >
          <Select
            v-model="selectedContextLorebooks"
            :options="availableLorebooks"
            multiple
            placeholder="Select books..."
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
                placeholder="All entries (select to restrict)"
              />
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <FormItem :label="t('extensionsBuiltin.rewrite.popup.instruction')">
        <div class="input-with-reset">
          <Textarea v-model="promptOverride" :rows="2" allow-maximize />
          <Button
            v-if="canResetPrompt"
            class="reset-btn"
            icon="fa-rotate-left"
            variant="ghost"
            title="Reset to template default"
            @click="resetPrompt"
          />
        </div>
      </FormItem>
    </CollapsibleSection>

    <!-- Split diff view for templates that use input -->
    <div v-if="!IGNORE_INPUT" class="split-view">
      <!-- Original / Left Pane -->
      <div class="pane">
        <div class="pane-header">{{ t('extensionsBuiltin.rewrite.popup.original') }}</div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div ref="leftPaneRef" class="pane-content diff-content" @scroll="onLeftScroll" v-html="leftHtml"></div>
      </div>

      <!-- Generated / Right Pane -->
      <div class="pane">
        <div class="pane-header">
          <span>
            {{ t('extensionsBuiltin.rewrite.popup.new') }}
            <span v-if="isGenerating" class="generating-indicator"
              ><i class="fa-solid fa-circle-notch fa-spin"></i
            ></span>
          </span>
          <button v-if="generatedText" class="copy-btn" title="Copy to clipboard" @click="handleCopyOutput">
            <i class="fa-solid fa-copy"></i>
          </button>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div ref="rightPaneRef" class="pane-content diff-content" @scroll="onRightScroll" v-html="rightHtml"></div>
      </div>
    </div>

    <!-- Single output view for templates that ignore input -->
    <div v-else class="single-view">
      <div class="pane">
        <div class="pane-header">
          <span>
            {{ t('extensionsBuiltin.rewrite.popup.output') }}
            <span v-if="isGenerating" class="generating-indicator"
              ><i class="fa-solid fa-circle-notch fa-spin"></i
            ></span>
          </span>
          <button v-if="generatedText" class="copy-btn" title="Copy to clipboard" @click="handleCopyOutput">
            <i class="fa-solid fa-copy"></i>
          </button>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div ref="rightPaneRef" class="pane-content" v-html="rightHtml"></div>
      </div>
    </div>

    <div class="actions-row">
      <Button v-if="!isGenerating" @click="handleGenerate">
        {{ t('extensionsBuiltin.rewrite.popup.generate') }}
      </Button>
      <Button v-else variant="danger" @click="handleAbort">
        {{ t('extensionsBuiltin.rewrite.popup.abort') }}
      </Button>
      <div class="spacer"></div>
      <Button variant="ghost" @click="handleCancel">{{ t('common.cancel') }}</Button>
      <Button variant="confirm" :disabled="!generatedText || isGenerating" @click="handleApply">{{
        t('extensionsBuiltin.rewrite.popup.apply')
      }}</Button>
    </div>
  </div>
</template>

<style scoped>
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

.split-view {
  display: flex;
  gap: 10px;
  flex: 1;
  min-height: 300px;
  overflow: hidden;
}

.single-view {
  display: flex;
  flex: 1;
  min-height: 300px;
  overflow: hidden;
}

.pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background-color: var(--black-30a);
  min-width: 0;
  min-height: 0;
  max-height: 400px;
}

.pane-header {
  padding: 5px 10px;
  border-bottom: 1px solid var(--theme-border-color);
  font-weight: bold;
  background-color: var(--white-20a);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.copy-btn {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  padding: 4px 8px;
  border-radius: 3px;
  transition: opacity 0.2s;
}

.copy-btn:hover {
  opacity: 1;
  background-color: var(--black-20a);
}

.pane-content {
  flex: 1;
  padding: 10px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-family-mono);
  font-size: 0.9em;
  line-height: 1.5;
}

:deep(.diff-del) {
  background-color: var(--color-accent-crimson-70a);
  text-decoration: line-through;
  opacity: 0.8;
  border-radius: 2px;
}

:deep(.diff-ins) {
  background-color: var(--color-accent-green-70a);
  border-radius: 2px;
}

.actions-row {
  display: flex;
  gap: 10px;
  margin-top: auto;
}

.spacer {
  flex: 1;
}

.generating-indicator {
  color: var(--theme-text-color);
  opacity: 0.7;
}
</style>
