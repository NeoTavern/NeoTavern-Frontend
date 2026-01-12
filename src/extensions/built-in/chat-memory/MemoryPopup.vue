<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { Button, FormItem, Input, Select, Tabs, Textarea, Toggle } from '../../../components/UI';
import { useStrictI18n } from '../../../composables/useStrictI18n';
import type { ApiChatMessage, ChatMessage, ExtensionAPI } from '../../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types';
import type { TextareaToolDefinition } from '../../../types/ExtensionAPI';
import type { WorldInfoEntry } from '../../../types/world-info';
import {
  DEFAULT_MESSAGE_SUMMARY_PROMPT,
  DEFAULT_PROMPT,
  EXTENSION_KEY,
  type ChatMemoryMetadata,
  type ChatMemoryRecord,
  type ExtensionSettings,
  type MemoryMessageExtra,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<ExtensionSettings>;
}>();

// TODO: i18n

const { t } = useStrictI18n();

// --- Tabs ---
const activeTab = ref('lorebook');
const tabs = [
  { label: 'Lorebook Summaries', value: 'lorebook', icon: 'fa-book-atlas' },
  { label: 'Message Summaries', value: 'messages', icon: 'fa-message' },
];

// --- Shared State ---
const connectionProfile = ref<string | undefined>(undefined);
const isGenerating = ref(false);
const abortController = ref<AbortController | null>(null);

// --- Lorebook Tab State ---
const startIndex = ref<number>(0);
const endIndex = ref<number>(0);
const lorebookPrompt = ref<string>(DEFAULT_PROMPT);
const summaryResult = ref<string>('');
const isSaving = ref(false);
const autoHideMessages = ref(true);
const selectedLorebook = ref<string>('');
const availableLorebooks = ref<{ label: string; value: string }[]>([]);

// --- Messages Tab State ---
const messageSummaryPrompt = ref<string>(DEFAULT_MESSAGE_SUMMARY_PROMPT);
const enableMessageSummarization = ref(false);
const autoMessageSummarize = ref(false);
const bulkProgress = ref<{ current: number; total: number } | null>(null);

// --- Computed (Lorebook) ---
const chatHistory = computed(() => props.api.chat.getHistory());

const maxIndex = computed(() => {
  const history = chatHistory.value;
  return history.length > 0 ? history.length - 1 : 0;
});

const hasMessages = computed(() => chatHistory.value.length > 0);

const startIndexError = computed(() => {
  if (!hasMessages.value) return 'No messages available';
  if (startIndex.value === undefined || startIndex.value === null || startIndex.value === ('' as unknown as number))
    return 'Value is required';
  if (!Number.isInteger(Number(startIndex.value))) return 'Must be an integer';
  if (startIndex.value < 0) return 'Cannot be negative';
  if (startIndex.value > maxIndex.value) return 'Index out of bounds';
  if (startIndex.value > endIndex.value) return 'Start cannot be greater than End';
  return undefined;
});

const endIndexError = computed(() => {
  if (!hasMessages.value) return 'No messages available';
  if (endIndex.value === undefined || endIndex.value === null || endIndex.value === ('' as unknown as number))
    return 'Value is required';
  if (!Number.isInteger(Number(endIndex.value))) return 'Must be an integer';
  if (endIndex.value < 0) return 'Cannot be negative';
  if (endIndex.value > maxIndex.value) return 'Cannot exceed total messages';
  if (endIndex.value < startIndex.value) return 'End cannot be less than Start';
  return undefined;
});

const isValidRange = computed(() => {
  return hasMessages.value && !startIndexError.value && !endIndexError.value;
});

// Existing memories retrieved from Chat Metadata
const existingMemories = computed(() => {
  const currentMetadata = props.api.chat.metadata.get();
  if (!currentMetadata) return [];
  const memoryExtra = (currentMetadata.extra?.[EXTENSION_KEY] as ChatMemoryMetadata) || { memories: [] };
  return memoryExtra.memories || [];
});

const hasMemories = computed(() => existingMemories.value.length > 0);

const overlapWarning = computed(() => {
  if (!isValidRange.value) return null;
  const start = startIndex.value;
  const end = endIndex.value;
  for (const memory of existingMemories.value) {
    const [mStart, mEnd] = memory.range;
    if (Math.max(start, mStart) <= Math.min(end, mEnd)) {
      return t('extensionsBuiltin.chatMemory.overlapWarning');
    }
  }
  return null;
});

// Timeline Data
interface TimelineSegment {
  start: number;
  end: number;
  type: 'memory' | 'selection' | 'overlap';
  widthPercent: number;
  leftPercent: number;
  title: string;
}

const timelineSegments = computed(() => {
  const totalMessages = maxIndex.value + 1;
  if (totalMessages <= 0) return [];
  const segments: TimelineSegment[] = [];

  existingMemories.value.forEach((mem) => {
    const [s, e] = mem.range;
    segments.push({
      start: s,
      end: e,
      type: 'memory',
      leftPercent: (s / totalMessages) * 100,
      widthPercent: ((e - s + 1) / totalMessages) * 100,
      title: `Memory: ${s} - ${e}`,
    });
  });

  if (isValidRange.value) {
    const s = startIndex.value;
    const e = endIndex.value;
    const type = overlapWarning.value ? 'overlap' : 'selection';
    segments.push({
      start: s,
      end: e,
      type,
      leftPercent: (s / totalMessages) * 100,
      widthPercent: ((e - s + 1) / totalMessages) * 100,
      title: `Current Selection: ${s} - ${e}`,
    });
  }
  return segments;
});

// --- Computed (Messages) ---
const messageStats = computed(() => {
  const history = chatHistory.value;
  let total = 0;
  let summarized = 0;
  history.forEach((msg) => {
    if (msg.is_system) return;
    total++;
    const extra = msg.extra?.[EXTENSION_KEY] as MemoryMessageExtra | undefined;
    if (extra?.summary) summarized++;
  });
  return { total, summarized };
});

// --- Tools ---
const promptTools = computed<TextareaToolDefinition[]>(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    onClick: ({ setValue }) => {
      setValue(DEFAULT_PROMPT);
    },
  },
]);

const messagePromptTools = computed<TextareaToolDefinition[]>(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    onClick: ({ setValue }) => {
      setValue(DEFAULT_MESSAGE_SUMMARY_PROMPT);
    },
  },
]);

// --- Lifecycle ---
onMounted(async () => {
  endIndex.value = maxIndex.value;

  const memories = existingMemories.value;
  let suggestedStart = 0;
  if (memories.length > 0) {
    const lastMemoryEnd = Math.max(...memories.map((m) => m.range[1]));
    suggestedStart = Math.min(lastMemoryEnd + 1, endIndex.value);
  } else {
    suggestedStart = Math.max(0, endIndex.value - 20);
  }
  startIndex.value = suggestedStart;

  refreshLorebooks();
  loadSettings();
});

onUnmounted(() => {
  if (abortController.value) {
    abortController.value.abort();
  }
});

// Auto-save settings
watch(
  [
    connectionProfile,
    lorebookPrompt,
    autoHideMessages,
    selectedLorebook,
    enableMessageSummarization,
    autoMessageSummarize,
    messageSummaryPrompt,
  ],
  () => {
    saveSettings();
  },
  { deep: true },
);

// --- Common Methods ---

function loadSettings() {
  const settings = props.api.settings.get();
  if (settings) {
    if (settings.connectionProfile) connectionProfile.value = settings.connectionProfile;
    if (settings.prompt) lorebookPrompt.value = settings.prompt;
    if (settings.autoHideMessages !== undefined) autoHideMessages.value = settings.autoHideMessages;
    if (settings.lastLorebook && availableLorebooks.value.some((b) => b.value === settings.lastLorebook)) {
      selectedLorebook.value = settings.lastLorebook;
    }

    if (settings.enableMessageSummarization !== undefined)
      enableMessageSummarization.value = settings.enableMessageSummarization;
    if (settings.autoMessageSummarize !== undefined) autoMessageSummarize.value = settings.autoMessageSummarize;
    if (settings.messageSummaryPrompt) messageSummaryPrompt.value = settings.messageSummaryPrompt;
  }

  if (!connectionProfile.value) {
    const globalProfile = props.api.settings.get('connectionProfile');
    if (globalProfile) {
      connectionProfile.value = globalProfile;
    }
  }
}

function saveSettings() {
  const newSettings: ExtensionSettings = {
    connectionProfile: connectionProfile.value,
    prompt: lorebookPrompt.value,
    autoHideMessages: autoHideMessages.value,
    lastLorebook: selectedLorebook.value,
    enableMessageSummarization: enableMessageSummarization.value,
    autoMessageSummarize: autoMessageSummarize.value,
    messageSummaryPrompt: messageSummaryPrompt.value,
  };
  props.api.settings.set(undefined, newSettings);
  props.api.settings.save();
}

function cancelGeneration() {
  if (abortController.value) {
    abortController.value.abort();
    abortController.value = null;
    isGenerating.value = false;
    bulkProgress.value = null;
    props.api.ui.showToast(t('common.cancelled'), 'info');
  }
}

// --- Lorebook Logic ---

function refreshLorebooks() {
  const books = props.api.worldInfo.getAllBookNames();
  availableLorebooks.value = books.map((b) => ({
    label: b.name,
    value: b.file_id,
  }));

  if (!selectedLorebook.value) {
    const activeBooks = props.api.worldInfo.getActiveBookNames();
    if (activeBooks.length > 0) {
      selectedLorebook.value = activeBooks[0];
    } else if (availableLorebooks.value.length > 0) {
      selectedLorebook.value = availableLorebooks.value[0].value;
    }
  }
}

async function handleLorebookSummarize() {
  if (!connectionProfile.value) {
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.noProfile'), 'error');
    return;
  }
  if (!isValidRange.value) return;

  isGenerating.value = true;
  summaryResult.value = '';
  abortController.value = new AbortController();

  try {
    const messagesSlice = chatHistory.value.slice(startIndex.value, endIndex.value + 1);
    const textToSummarize = messagesSlice.map((m) => `${m.name}: ${m.mes}`).join('\n\n');

    const compiledPrompt = props.api.macro.process(lorebookPrompt.value, undefined, {
      text: textToSummarize,
    });
    const messages: Array<ApiChatMessage> = [{ role: 'system', content: compiledPrompt, name: 'System' }];

    const response = await props.api.llm.generate(messages, {
      connectionProfileName: connectionProfile.value,
      signal: abortController.value.signal,
    });

    let fullContent = '';
    if (typeof response === 'function') {
      const generator = response();
      for await (const chunk of generator) {
        if (!isGenerating.value) break;
        fullContent += chunk.delta;
        summaryResult.value = fullContent;
      }
    } else {
      fullContent = response.content;
    }

    if (isGenerating.value) {
      const codeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
      const match = fullContent.match(codeBlockRegex);
      summaryResult.value = match && match[1] ? match[1].trim() : fullContent.trim();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      console.error('Summarization failed', error);
      props.api.ui.showToast('Summarization failed', 'error');
    }
  } finally {
    isGenerating.value = false;
    abortController.value = null;
  }
}

async function createEntry() {
  if (isSaving.value) return;
  if (!selectedLorebook.value) {
    props.api.ui.showToast('Please select a Lorebook', 'error');
    return;
  }
  if (!summaryResult.value.trim()) {
    props.api.ui.showToast('Summary is empty', 'error');
    return;
  }

  isSaving.value = true;

  try {
    const book = await props.api.worldInfo.getBook(selectedLorebook.value);
    if (!book) {
      props.api.ui.showToast('Selected Lorebook not found', 'error');
      return;
    }

    const newUid = props.api.worldInfo.getNewUid(book);
    const newEntry: WorldInfoEntry = {
      ...props.api.worldInfo.createDefaultEntry(newUid),
      comment: `Memory: Msg ${startIndex.value}-${endIndex.value}`,
      content: summaryResult.value,
      constant: true,
      order: endIndex.value,
    };

    await props.api.worldInfo.createEntry(selectedLorebook.value, newEntry);

    const currentMetadata = props.api.chat.metadata.get();
    if (currentMetadata) {
      const memoryExtra = (currentMetadata.extra?.[EXTENSION_KEY] as ChatMemoryMetadata) || { memories: [] };
      const memoryRecord: ChatMemoryRecord = {
        bookName: selectedLorebook.value,
        entryUid: newEntry.uid,
        range: [startIndex.value, endIndex.value],
        timestamp: Date.now(),
      };
      const updatedExtra = {
        ...currentMetadata.extra,
        [EXTENSION_KEY]: { ...memoryExtra, memories: [...memoryExtra.memories, memoryRecord] },
      };
      props.api.chat.metadata.update({ extra: updatedExtra });
    }

    for (let i = startIndex.value; i <= endIndex.value; i++) {
      const msg = chatHistory.value[i];
      const extraUpdate: MemoryMessageExtra = {
        summarized: true,
        original_is_system: msg.is_system,
        summary: (msg.extra?.[EXTENSION_KEY] as MemoryMessageExtra)?.summary, // Preserve message summary if any
      };
      const updates: Partial<ChatMessage> = {
        extra: { ...msg.extra, [EXTENSION_KEY]: extraUpdate },
      };
      if (autoHideMessages.value) {
        updates.is_system = true;
      }
      await props.api.chat.updateMessageObject(i, updates);
    }
    props.api.ui.showToast('Memory created', 'success');
  } catch (error) {
    console.error('Failed to create memory entry', error);
    props.api.ui.showToast('Failed to create memory entry', 'error');
  } finally {
    isSaving.value = false;
  }
}

async function handleLorebookReset() {
  const { result } = await props.api.ui.showPopup({
    title: 'Reset Memory',
    content:
      'This will remove all auto-generated memory entries for this chat and unhide the original messages. Are you sure?',
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.confirm',
    cancelButton: 'common.cancel',
  });

  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  const currentMetadata = props.api.chat.metadata.get();
  if (!currentMetadata) {
    props.api.ui.showToast('No chat metadata found', 'error');
    return;
  }

  let restoredCount = 0;
  let entriesRemoved = 0;

  try {
    const memoryExtra = currentMetadata.extra?.[EXTENSION_KEY] as ChatMemoryMetadata | undefined;
    if (memoryExtra && Array.isArray(memoryExtra.memories)) {
      for (const record of memoryExtra.memories) {
        try {
          await props.api.worldInfo.deleteEntry(record.bookName, record.entryUid);
          entriesRemoved++;
        } catch (err) {
          console.warn('Failed to cleanup memory entry', record, err);
        }
      }
      const updatedExtra = { ...currentMetadata.extra };
      delete updatedExtra[EXTENSION_KEY];
      props.api.chat.metadata.update({ extra: updatedExtra });
    }

    const history = chatHistory.value;
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      const memExtra = msg.extra?.[EXTENSION_KEY] as MemoryMessageExtra | undefined;
      if (memExtra && memExtra.summarized) {
        await props.api.chat.updateMessageObject(i, {
          is_system: memExtra.original_is_system ?? false,
          extra: {
            ...msg.extra,
            [EXTENSION_KEY]: { ...memExtra, summarized: false }, // Keep summary text if exists
          },
        });
        restoredCount++;
      }
    }
    props.api.ui.showToast(`Restored ${restoredCount} messages, deleted ${entriesRemoved} entries.`, 'success');
  } catch (error) {
    console.error('Reset failed', error);
    props.api.ui.showToast('Reset failed', 'error');
  }
}

// --- Message Summary Logic ---

async function bulkSummarizeMessages() {
  if (!connectionProfile.value) {
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.noProfile'), 'error');
    return;
  }

  const { result } = await props.api.ui.showPopup({
    title: 'Bulk Summarize',
    content:
      'This will generate summaries for all non-system messages that do not have one yet. This may take a while and consume API credits. Continue?',
    type: POPUP_TYPE.CONFIRM,
  });

  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  isGenerating.value = true;
  abortController.value = new AbortController();

  const history = chatHistory.value;
  const targetIndices: number[] = [];

  history.forEach((msg, idx) => {
    if (msg.is_system) return;
    const extra = msg.extra?.[EXTENSION_KEY] as MemoryMessageExtra | undefined;
    if (!extra?.summary) {
      targetIndices.push(idx);
    }
  });

  if (targetIndices.length === 0) {
    props.api.ui.showToast('No messages need summarization', 'info');
    isGenerating.value = false;
    return;
  }

  bulkProgress.value = { current: 0, total: targetIndices.length };

  try {
    for (const idx of targetIndices) {
      if (abortController.value?.signal.aborted) break;

      const msg = history[idx];
      const prompt = props.api.macro.process(messageSummaryPrompt.value, undefined, { text: msg.mes });

      const response = await props.api.llm.generate([{ role: 'system', content: prompt, name: 'System' }], {
        connectionProfileName: connectionProfile.value,
      });

      let fullContent = '';
      if (typeof response === 'function') {
        const generator = response();
        for await (const chunk of generator) {
          fullContent += chunk.delta;
        }
      } else {
        fullContent = response.content;
      }

      const codeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
      const match = fullContent.match(codeBlockRegex);
      const text = match && match[1] ? match[1].trim() : fullContent.trim();

      const currentExtra = (msg.extra?.[EXTENSION_KEY] as MemoryMessageExtra) || {};
      await props.api.chat.updateMessageObject(idx, {
        extra: {
          ...msg.extra,
          [EXTENSION_KEY]: { ...currentExtra, summary: text },
        },
      });

      bulkProgress.value.current++;
    }

    if (!abortController.value?.signal.aborted) {
      props.api.ui.showToast('Bulk summarization complete', 'success');
    }
  } catch (error) {
    console.error('Bulk summarization error', error);
    props.api.ui.showToast('Error during bulk summarization', 'error');
  } finally {
    isGenerating.value = false;
    bulkProgress.value = null;
    abortController.value = null;
  }
}

async function handleMessageReset() {
  const { result } = await props.api.ui.showPopup({
    title: 'Reset Message Summaries',
    content: 'This will delete all per-message summaries. Are you sure?',
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.confirm',
    cancelButton: 'common.cancel',
  });

  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  const history = chatHistory.value;
  let count = 0;

  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    const extra = msg.extra?.[EXTENSION_KEY] as MemoryMessageExtra | undefined;
    if (extra?.summary) {
      await props.api.chat.updateMessageObject(i, {
        extra: {
          ...msg.extra,
          [EXTENSION_KEY]: { ...extra, summary: undefined },
        },
      });
      count++;
    }
  }
  props.api.ui.showToast(`Removed summaries from ${count} messages`, 'success');
}
</script>

<template>
  <div class="memory-popup">
    <!-- Header -->
    <div class="header-controls">
      <Tabs v-model="activeTab" :options="tabs" class="main-tabs" />
    </div>

    <!-- Connection Profile Global Setting for the Popup -->
    <div class="section">
      <FormItem label="Connection Profile" description="Used for generating summaries">
        <ConnectionProfileSelector v-model="connectionProfile" />
      </FormItem>
    </div>

    <!-- Lorebook Tab -->
    <div v-show="activeTab === 'lorebook'" class="tab-content">
      <div class="section">
        <div class="section-title">1. {{ t('common.select') }} Range</div>
        <div class="timeline-container" title="Memory Timeline">
          <div class="timeline-bar">
            <div
              v-for="(seg, idx) in timelineSegments"
              :key="idx"
              class="timeline-segment"
              :class="seg.type"
              :style="{ left: seg.leftPercent + '%', width: seg.widthPercent + '%' }"
              :title="seg.title"
            ></div>
          </div>
          <div class="timeline-labels">
            <span>0</span>
            <span>{{ maxIndex + 1 }} msgs</span>
          </div>
        </div>
        <div class="row">
          <FormItem label="Start Index" style="flex: 1" :error="startIndexError">
            <Input v-model.number="startIndex" type="number" :min="0" :max="endIndex" />
          </FormItem>
          <FormItem label="End Index" style="flex: 1" :error="endIndexError">
            <Input v-model.number="endIndex" type="number" :min="startIndex" :max="maxIndex" />
          </FormItem>
        </div>
        <div v-if="overlapWarning" class="warning-banner">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>{{ overlapWarning }}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">2. Summarize</div>
        <FormItem label="Lorebook Summarization Prompt">
          <Textarea
            v-model="lorebookPrompt"
            :rows="4"
            allow-maximize
            :tools="promptTools"
            identifier="extension.chat-memory.prompt"
          />
        </FormItem>
        <div class="actions">
          <Button v-if="isGenerating" variant="danger" icon="fa-stop" @click="cancelGeneration">
            {{ t('common.cancel') }}
          </Button>
          <Button
            v-else
            :loading="isGenerating"
            :disabled="!isValidRange || !connectionProfile"
            icon="fa-wand-magic-sparkles"
            @click="handleLorebookSummarize"
          >
            Generate Summary
          </Button>
        </div>
        <FormItem label="Result">
          <Textarea
            v-model="summaryResult"
            :rows="6"
            placeholder="Generated summary will appear here..."
            allow-maximize
          />
        </FormItem>
      </div>

      <div class="section highlight">
        <div class="section-title">3. Create Memory</div>
        <div class="row">
          <FormItem label="Target Lorebook" style="flex: 1">
            <Select v-model="selectedLorebook" :options="availableLorebooks" placeholder="Select a Lorebook" />
          </FormItem>
        </div>
        <FormItem label="Auto-hide messages">
          <Toggle v-model="autoHideMessages" label="Auto-hide messages" />
        </FormItem>
        <div class="actions">
          <Button
            variant="confirm"
            icon="fa-save"
            :loading="isSaving"
            :disabled="!summaryResult || !selectedLorebook"
            @click="createEntry"
          >
            Create Constant Entry & Hide Messages
          </Button>
        </div>
      </div>

      <div class="section danger-zone">
        <div class="section-title">Manage</div>
        <div class="actions">
          <Button
            variant="danger"
            icon="fa-rotate-left"
            :disabled="!hasMemories"
            :title="!hasMemories ? 'No memories to reset for this chat' : ''"
            @click="handleLorebookReset"
          >
            Reset Memories for Current Chat
          </Button>
        </div>
      </div>
    </div>

    <!-- Message Summaries Tab -->
    <div v-show="activeTab === 'messages'" class="tab-content">
      <div class="section">
        <div class="section-title">Settings</div>
        <FormItem>
          <Toggle v-model="enableMessageSummarization" label="Enable Message Summarization" />
        </FormItem>
        <FormItem
          label="Auto-summarize new messages"
          description="Automatically generate summaries for new messages as they arrive."
        >
          <Toggle v-model="autoMessageSummarize" :disabled="!enableMessageSummarization" label="Auto-trigger" />
        </FormItem>
        <FormItem label="Message Summary Prompt" description="Prompt used to summarize a single message.">
          <Textarea
            v-model="messageSummaryPrompt"
            :rows="4"
            allow-maximize
            :tools="messagePromptTools"
            identifier="extension.chat-memory.message-prompt"
          />
        </FormItem>
      </div>

      <div class="section highlight">
        <div class="section-title">Actions</div>
        <div class="stats">
          <p>
            Total Messages: <strong>{{ messageStats.total }}</strong>
          </p>
          <p>
            Summarized: <strong>{{ messageStats.summarized }}</strong>
          </p>
        </div>

        <div v-if="bulkProgress" class="progress-bar">
          <div class="progress-fill" :style="{ width: (bulkProgress.current / bulkProgress.total) * 100 + '%' }"></div>
          <span class="progress-text">{{ bulkProgress.current }} / {{ bulkProgress.total }}</span>
        </div>

        <div class="actions">
          <Button v-if="isGenerating" variant="danger" icon="fa-stop" @click="cancelGeneration"> Stop </Button>
          <Button
            v-else
            icon="fa-layer-group"
            :loading="isGenerating"
            :disabled="!enableMessageSummarization || !connectionProfile"
            @click="bulkSummarizeMessages"
          >
            Bulk Summarize Missing
          </Button>
        </div>
      </div>

      <div class="section danger-zone">
        <div class="section-title">Manage</div>
        <div class="actions">
          <Button variant="danger" icon="fa-trash-can" @click="handleMessageReset">
            Delete All Message Summaries
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.memory-popup {
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding: 10px;
  max-height: 80vh;
  overflow-y: auto;
}

.header-controls {
  display: flex;
  justify-content: center;
  margin-bottom: 10px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--theme-border-color);

  &:last-child {
    border-bottom: none;
  }

  &.highlight {
    background-color: var(--black-30a);
    padding: 15px;
    border-radius: var(--base-border-radius);
    border: 1px solid var(--theme-underline-color);
  }

  &.danger-zone {
    margin-top: 10px;
    border: 1px solid var(--color-accent-red);
    padding: 15px;
    border-radius: var(--base-border-radius);

    .section-title {
      color: var(--color-accent-red);
    }
  }
}

.section-title {
  font-weight: bold;
  font-size: 1.1em;
  color: var(--theme-text-color);
  margin-bottom: 5px;
}

.row {
  display: flex;
  gap: 15px;
  width: 100%;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin: 5px 0;
}

.stats {
  display: flex;
  gap: 20px;
  margin-bottom: 10px;
  p {
    margin: 0;
    color: var(--theme-emphasis-color);
    strong {
      color: var(--theme-text-color);
    }
  }
}

.progress-bar {
  height: 20px;
  background-color: var(--black-50a);
  border-radius: 10px;
  overflow: hidden;
  position: relative;
  margin-bottom: 10px;
  border: 1px solid var(--theme-border-color);

  .progress-fill {
    height: 100%;
    background-color: var(--color-accent-green);
    transition: width 0.3s ease;
  }

  .progress-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 0.8em;
    font-weight: bold;
    color: var(--white-100);
    text-shadow: 0 0 2px black;
  }
}

/* Timeline Visualization */
.timeline-container {
  margin-bottom: 15px;
  padding: 10px 0;
}

.timeline-bar {
  position: relative;
  height: 12px;
  background-color: var(--black-50a);
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--theme-border-color);
  width: 100%;
}

.timeline-segment {
  position: absolute;
  height: 100%;
  top: 0;
  transition: all 0.2s ease;

  &.memory {
    background-color: var(--color-accent-green-70a);
    opacity: 0.8;
  }

  &.selection {
    background-color: var(--color-info-cobalt);
    opacity: 0.7;
    z-index: 2;
    border: 1px solid var(--white-50a);
  }

  &.overlap {
    background-color: var(--color-warning);
    opacity: 0.9;
    z-index: 3;
    animation: pulse 2s infinite;
  }
}

.timeline-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.8em;
  color: var(--theme-emphasis-color);
  margin-top: 5px;
}

@keyframes pulse {
  0% {
    opacity: 0.7;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.7;
  }
}

.warning-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  background-color: var(--black-30a);
  border-left: 3px solid var(--color-warning);
  border-radius: var(--base-border-radius);
  color: var(--color-warning-amber);

  i {
    font-size: 1.2em;
  }
}
</style>
