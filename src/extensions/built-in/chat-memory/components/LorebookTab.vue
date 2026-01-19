<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Button, FormItem, Input, Select, Textarea, Toggle } from '../../../../components/UI';
import { WorldInfoPosition } from '../../../../constants';
import type { ApiChatMessage, ExtensionAPI } from '../../../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../../../types';
import type { TextareaToolDefinition } from '../../../../types/ExtensionAPI';
import type { WorldInfoEntry } from '../../../../types/world-info';
import {
  DEFAULT_PROMPT,
  type ChatMemoryMetadata,
  type ChatMemoryRecord,
  type ExtensionSettings,
  type MemoryMessageExtra,
} from '../types';
import TimelineVisualizer, { type TimelineSegment } from './TimelineVisualizer.vue';

const props = defineProps<{
  api: ExtensionAPI<ExtensionSettings, ChatMemoryMetadata, MemoryMessageExtra>;
  connectionProfile?: string;
}>();

const t = props.api.i18n.t;

// State
const startIndex = ref<number>(0);
const endIndex = ref<number>(0);
const lorebookPrompt = ref<string>(DEFAULT_PROMPT);
const summaryResult = ref<string>('');
const isGenerating = ref(false);
const isSaving = ref(false);
const autoHideMessages = ref(true);
const selectedLorebook = ref<string>('');
const availableLorebooks = ref<{ label: string; value: string }[]>([]);
const abortController = ref<AbortController | null>(null);

// Computed
const chatHistory = computed(() => props.api.chat.getHistory());
const maxIndex = computed(() => {
  const history = chatHistory.value;
  return history.length > 0 ? history.length - 1 : 0;
});
const hasMessages = computed(() => chatHistory.value.length > 0);

const startIndexError = computed(() => {
  if (!hasMessages.value) return t('extensionsBuiltin.chatMemory.errors.noMessages');
  if (startIndex.value === undefined || startIndex.value === null)
    return t('extensionsBuiltin.chatMemory.errors.required');
  if (startIndex.value < 0) return t('extensionsBuiltin.chatMemory.errors.negative');
  if (startIndex.value > maxIndex.value) return t('extensionsBuiltin.chatMemory.errors.outOfBounds');
  if (startIndex.value > endIndex.value) return t('extensionsBuiltin.chatMemory.errors.startGreaterThanEnd');
  return undefined;
});

const endIndexError = computed(() => {
  if (!hasMessages.value) return t('extensionsBuiltin.chatMemory.errors.noMessages');
  if (endIndex.value === undefined || endIndex.value === null) return t('extensionsBuiltin.chatMemory.errors.required');
  if (endIndex.value < 0) return t('extensionsBuiltin.chatMemory.errors.negative');
  if (endIndex.value > maxIndex.value) return t('extensionsBuiltin.chatMemory.errors.exceedTotal');
  if (endIndex.value < startIndex.value) return t('extensionsBuiltin.chatMemory.errors.endLessThanStart');
  return undefined;
});

const isValidRange = computed(() => hasMessages.value && !startIndexError.value && !endIndexError.value);

const existingMemories = computed(() => {
  const currentMetadata = props.api.chat.metadata.get();
  if (!currentMetadata) return [];
  return currentMetadata.extra?.['core.chat-memory']?.memories || [];
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

const timelineSegments = computed<TimelineSegment[]>(() => {
  const segments: TimelineSegment[] = [];
  existingMemories.value.forEach((mem) => {
    const [s, e] = mem.range;
    segments.push({
      start: s,
      end: e,
      type: 'memory',
      title: t('extensionsBuiltin.chatMemory.timeline.memory', { start: s, end: e }),
    });
  });

  if (isValidRange.value) {
    segments.push({
      start: startIndex.value,
      end: endIndex.value,
      type: overlapWarning.value ? 'overlap' : 'selection',
      title: t('extensionsBuiltin.chatMemory.timeline.currentSelection', {
        start: startIndex.value,
        end: endIndex.value,
      }),
    });
  }
  return segments;
});

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

// Methods
function refreshLorebooks() {
  const books = props.api.worldInfo.getAllBookNames();
  availableLorebooks.value = books.map((b) => ({
    label: b.name,
    value: b.file_id,
  }));
}

function loadState() {
  // Load Global Settings
  const settings = props.api.settings.get();
  if (settings) {
    if (settings.prompt) lorebookPrompt.value = settings.prompt;
    if (settings.autoHideMessages !== undefined) autoHideMessages.value = settings.autoHideMessages;
  }

  // Load Chat Metadata (Persisted State)
  const currentMetadata = props.api.chat.metadata.get();
  const memoryExtra = currentMetadata?.extra?.['core.chat-memory'] ?? { memories: [] };

  // 1. Lorebook Selection
  if (memoryExtra.targetLorebook && availableLorebooks.value.some((b) => b.value === memoryExtra.targetLorebook)) {
    selectedLorebook.value = memoryExtra.targetLorebook;
  } else {
    // Fallback logic
    const activeBooks = props.api.worldInfo.getActiveBookNames();
    if (activeBooks.length > 0) {
      selectedLorebook.value = activeBooks[0];
    } else if (availableLorebooks.value.length > 0) {
      selectedLorebook.value = availableLorebooks.value[0].value;
    }
  }

  // 2. Range Selection
  if (memoryExtra.lorebookRange && Array.isArray(memoryExtra.lorebookRange) && memoryExtra.lorebookRange.length === 2) {
    startIndex.value = memoryExtra.lorebookRange[0];
    endIndex.value = memoryExtra.lorebookRange[1];
  } else {
    // Default heuristic
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
  }
}

function saveState() {
  // Save Global Settings
  props.api.settings.set('prompt', lorebookPrompt.value);
  props.api.settings.set('autoHideMessages', autoHideMessages.value);
  props.api.settings.save();

  // Save Chat Metadata
  const currentMetadata = props.api.chat.metadata.get();
  if (!currentMetadata) return;

  props.api.chat.metadata.update({
    extra: {
      'core.chat-memory': {
        memories: currentMetadata.extra?.['core.chat-memory']?.memories || [],
        targetLorebook: selectedLorebook.value,
        lorebookRange: [startIndex.value, endIndex.value],
      },
    },
  });
}

function cancelGeneration() {
  if (abortController.value) {
    abortController.value.abort();
    abortController.value = null;
    isGenerating.value = false;
    props.api.ui.showToast(t('common.cancelled'), 'info');
  }
}

async function handleLorebookSummarize() {
  if (!props.connectionProfile) {
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
      connectionProfile: props.connectionProfile,
      signal: abortController.value.signal,
    });

    let fullContent = '';
    if (Symbol.asyncIterator in response) {
      for await (const chunk of response) {
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
      props.api.ui.showToast(t('extensionsBuiltin.chatMemory.failed'), 'error');
    }
  } finally {
    isGenerating.value = false;
    abortController.value = null;
  }
}

async function createEntry() {
  if (isSaving.value) return;
  if (!selectedLorebook.value) {
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.placeholders.selectLorebook'), 'error');
    return;
  }
  if (!summaryResult.value.trim()) {
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.errors.emptySummary'), 'error');
    return;
  }

  isSaving.value = true;

  try {
    const book = await props.api.worldInfo.getBook(selectedLorebook.value);
    if (!book) {
      props.api.ui.showToast(t('extensionsBuiltin.chatMemory.errors.bookNotFound'), 'error');
      return;
    }

    const newUid = props.api.worldInfo.getNewUid(book);
    const newEntry: WorldInfoEntry = {
      ...props.api.worldInfo.createDefaultEntry(newUid),
      comment: `Memory: Msg ${startIndex.value}-${endIndex.value}`,
      content: summaryResult.value,
      constant: true,
      order: endIndex.value,
      position: WorldInfoPosition.AFTER_CHAR,
    };

    await props.api.worldInfo.createEntry(selectedLorebook.value, newEntry);

    // Update Metadata with new memory and current state
    const currentMetadata = props.api.chat.metadata.get();
    if (currentMetadata) {
      const memoryExtra = currentMetadata.extra?.['core.chat-memory'] || { memories: [] };
      const memoryRecord: ChatMemoryRecord = {
        bookName: selectedLorebook.value,
        entryUid: newEntry.uid,
        range: [startIndex.value, endIndex.value],
        timestamp: Date.now(),
      };
      props.api.chat.metadata.update({
        extra: {
          'core.chat-memory': {
            memories: [...memoryExtra.memories, memoryRecord],
            targetLorebook: selectedLorebook.value,
            lorebookRange: [startIndex.value, endIndex.value],
          },
        },
      });
    }

    for (let i = startIndex.value; i <= endIndex.value; i++) {
      const msg = chatHistory.value[i];
      await props.api.chat.updateMessageObject(i, {
        extra: {
          'core.chat-memory': {
            summarized: true,
            original_is_system: msg.is_system,
          },
        },
      });
    }
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.success.memoryCreated'), 'success');
  } catch (error) {
    console.error('Failed to create memory entry', error);
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.errors.createFailed'), 'error');
  } finally {
    isSaving.value = false;
  }
}

async function handleLorebookReset() {
  const { result } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.chatMemory.popups.reset.title'),
    content: t('extensionsBuiltin.chatMemory.popups.reset.content'),
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.confirm',
    cancelButton: 'common.cancel',
  });

  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  const currentMetadata = props.api.chat.metadata.get();
  if (!currentMetadata) {
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.errors.noMetadata'), 'error');
    return;
  }

  let restoredCount = 0;
  let entriesRemoved = 0;

  try {
    const memoryExtra = currentMetadata.extra?.['core.chat-memory'];
    if (memoryExtra && Array.isArray(memoryExtra.memories)) {
      for (const record of memoryExtra.memories) {
        try {
          await props.api.worldInfo.deleteEntry(record.bookName, record.entryUid);
          entriesRemoved++;
        } catch (err) {
          console.warn('Failed to cleanup memory entry', record, err);
        }
      }
      props.api.chat.metadata.update({
        extra: {
          'core.chat-memory': {
            memories: [],
          },
        },
      });
    }

    const history = chatHistory.value;
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      const memExtra = msg.extra['core.chat-memory'];
      if (memExtra && memExtra.summarized) {
        await props.api.chat.updateMessageObject(i, {
          is_system: memExtra.original_is_system ?? false,
          extra: {
            'core.chat-memory': {
              summarized: false,
            },
          },
        });
        restoredCount++;
      }
    }
    props.api.ui.showToast(
      t('extensionsBuiltin.chatMemory.success.restored', { restored: restoredCount, deleted: entriesRemoved }),
      'success',
    );
  } catch (error) {
    console.error('Reset failed', error);
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.failed'), 'error');
  }
}

onMounted(() => {
  refreshLorebooks();
  loadState();
});

onUnmounted(() => {
  if (abortController.value) {
    abortController.value.abort();
  }
});

watch(
  [lorebookPrompt, autoHideMessages, selectedLorebook, startIndex, endIndex],
  () => {
    saveState();
  },
  { deep: true },
);
</script>

<template>
  <div class="lorebook-tab">
    <div class="section">
      <div class="section-title">1. {{ t('extensionsBuiltin.chatMemory.manageRange') }}</div>
      <TimelineVisualizer :total-items="maxIndex + 1" :segments="timelineSegments" />
      <div class="row">
        <FormItem :label="t('extensionsBuiltin.chatMemory.labels.startIndex')" style="flex: 1" :error="startIndexError">
          <Input v-model.number="startIndex" type="number" :min="0" :max="endIndex" />
        </FormItem>
        <FormItem :label="t('extensionsBuiltin.chatMemory.labels.endIndex')" style="flex: 1" :error="endIndexError">
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
      <FormItem :label="t('extensionsBuiltin.chatMemory.labels.prompt')">
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
          {{ t('extensionsBuiltin.chatMemory.buttons.generate') }}
        </Button>
      </div>
      <FormItem :label="t('extensionsBuiltin.chatMemory.labels.result')">
        <Textarea
          v-model="summaryResult"
          :rows="6"
          :placeholder="t('extensionsBuiltin.chatMemory.placeholders.summaryResult')"
          identifier="extension.chat-memory.summary-result"
          allow-maximize
        />
      </FormItem>
    </div>

    <div class="section highlight">
      <div class="section-title">3. Create Memory</div>
      <div class="row">
        <FormItem :label="t('extensionsBuiltin.chatMemory.labels.targetLorebook')" style="flex: 1">
          <Select
            v-model="selectedLorebook"
            :options="availableLorebooks"
            :placeholder="t('extensionsBuiltin.chatMemory.placeholders.selectLorebook')"
          />
        </FormItem>
      </div>
      <FormItem :label="t('extensionsBuiltin.chatMemory.labels.autoHide')">
        <Toggle v-model="autoHideMessages" :label="t('extensionsBuiltin.chatMemory.labels.autoHide')" />
      </FormItem>
      <div class="actions">
        <Button
          variant="confirm"
          icon="fa-save"
          :loading="isSaving"
          :disabled="!summaryResult || !selectedLorebook"
          @click="createEntry"
        >
          {{ t('extensionsBuiltin.chatMemory.buttons.create') }}
        </Button>
      </div>
    </div>

    <div class="section danger-zone">
      <div class="section-title">{{ t('extensionsBuiltin.chatMemory.manage') }}</div>
      <div class="actions">
        <Button
          variant="danger"
          icon="fa-rotate-left"
          :disabled="!hasMemories"
          :title="!hasMemories ? t('extensionsBuiltin.chatMemory.tooltips.noMemoriesToReset') : ''"
          @click="handleLorebookReset"
        >
          {{ t('extensionsBuiltin.chatMemory.buttons.reset') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.lorebook-tab {
  display: flex;
  flex-direction: column;
  gap: 15px;
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
