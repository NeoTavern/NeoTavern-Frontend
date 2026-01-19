<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Button, FormItem, Input, Textarea, Toggle } from '../../../../components/UI';
import type { ExtensionAPI } from '../../../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../../../types';
import type { TextareaToolDefinition } from '../../../../types/ExtensionAPI';
import {
  DEFAULT_MESSAGE_SUMMARY_PROMPT,
  type ChatMemoryMetadata,
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
const messageSummaryPrompt = ref<string>(DEFAULT_MESSAGE_SUMMARY_PROMPT);
const enableMessageSummarization = ref(false);
const autoMessageSummarize = ref(false);
const ignoreSummaryCount = ref(100);
const bulkProgress = ref<{ current: number; total: number } | null>(null);
const isGenerating = ref(false);
const abortController = ref<AbortController | null>(null);

// Range State
const startIndex = ref<number>(0);
const endIndex = ref<number>(0);

// Computed
const chatHistory = computed(() => props.api.chat.getHistory());
const maxIndex = computed(() => {
  const history = chatHistory.value;
  return history.length > 0 ? history.length - 1 : 0;
});
const hasMessages = computed(() => chatHistory.value.length > 0);

const messageStats = computed(() => {
  const history = chatHistory.value;
  let total = 0;
  let summarized = 0;
  history.forEach((msg) => {
    if (msg.is_system) return;
    total++;
    const extra = msg.extra['core.chat-memory'];
    if (extra?.summary) summarized++;
  });
  return { total, summarized };
});

const timelineSegments = computed<TimelineSegment[]>(() => {
  const segments: TimelineSegment[] = [];
  const history = chatHistory.value;

  // Map summarized messages
  history.forEach((msg, idx) => {
    if (msg.is_system) return;
    const extra = msg.extra['core.chat-memory'];
    if (extra?.summary) {
      const lastSeg = segments[segments.length - 1];
      if (lastSeg && lastSeg.type === 'summarized' && lastSeg.end === idx - 1) {
        lastSeg.end = idx;
        lastSeg.title = t('extensionsBuiltin.chatMemory.timeline.summarized', { start: lastSeg.start, end: idx });
      } else {
        segments.push({
          start: idx,
          end: idx,
          type: 'summarized',
          title: t('extensionsBuiltin.chatMemory.timeline.summarizedSingle', { index: idx }),
        });
      }
    }
  });

  // Overlay Selection
  if (isValidRange.value) {
    segments.push({
      start: startIndex.value,
      end: endIndex.value,
      type: 'selection',
      title: t('extensionsBuiltin.chatMemory.timeline.selection', { start: startIndex.value, end: endIndex.value }),
    });
  }

  return segments;
});

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

const countUnsummarizedInRange = computed(() => {
  if (!isValidRange.value) return 0;
  let count = 0;
  const history = chatHistory.value;
  for (let i = startIndex.value; i <= endIndex.value; i++) {
    const msg = history[i];
    if (msg.is_system) continue;
    const extra = msg.extra['core.chat-memory'];
    if (!extra?.summary) {
      count++;
    }
  }
  return count;
});

const countSummarizedInRange = computed(() => {
  if (!isValidRange.value) return 0;
  let count = 0;
  const history = chatHistory.value;
  for (let i = startIndex.value; i <= endIndex.value; i++) {
    const msg = history[i];
    const extra = msg.extra['core.chat-memory'];
    if (extra?.summary) {
      count++;
    }
  }
  return count;
});

const promptTools = computed<TextareaToolDefinition[]>(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    onClick: ({ setValue }) => {
      setValue(DEFAULT_MESSAGE_SUMMARY_PROMPT);
    },
  },
]);

// Methods
function loadSettings() {
  const settings = props.api.settings.get();
  if (settings) {
    if (settings.enableMessageSummarization !== undefined)
      enableMessageSummarization.value = settings.enableMessageSummarization;
    if (settings.autoMessageSummarize !== undefined) autoMessageSummarize.value = settings.autoMessageSummarize;
    if (settings.messageSummaryPrompt) messageSummaryPrompt.value = settings.messageSummaryPrompt;
    if (settings.ignoreSummaryCount !== undefined) ignoreSummaryCount.value = settings.ignoreSummaryCount;
  }

  // Load Chat Metadata for Range
  const currentMetadata = props.api.chat.metadata.get();
  const memoryExtra = currentMetadata?.extra?.['core.chat-memory'] || { memories: [] };

  if (memoryExtra.summaryRange && Array.isArray(memoryExtra.summaryRange) && memoryExtra.summaryRange.length === 2) {
    startIndex.value = memoryExtra.summaryRange[0];
    endIndex.value = memoryExtra.summaryRange[1];
  } else {
    // Default
    startIndex.value = 0;
    endIndex.value = maxIndex.value;
  }
}

async function saveSettings() {
  // Save Global
  props.api.settings.set('enableMessageSummarization', enableMessageSummarization.value);
  props.api.settings.set('autoMessageSummarize', autoMessageSummarize.value);
  props.api.settings.set('messageSummaryPrompt', messageSummaryPrompt.value);
  props.api.settings.set('ignoreSummaryCount', ignoreSummaryCount.value);
  props.api.settings.save();
  // @ts-expect-error extension event
  await props.api.events.emit('chat-memory:refresh-ui');

  // Save Metadata (Range)
  const currentMetadata = props.api.chat.metadata.get();
  if (!currentMetadata) return;
  const memoryExtra = currentMetadata.extra?.['core.chat-memory'] || { memories: [] };

  props.api.chat.metadata.update({
    extra: {
      'core.chat-memory': {
        memories: memoryExtra.memories,
        summaryRange: [startIndex.value, endIndex.value],
      },
    },
  });
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

async function summarizeRange(mode: 'missing-only' | 'force-all') {
  if (!props.connectionProfile) {
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.noProfile'), 'error');
    return;
  }
  if (!isValidRange.value) return;

  const history = chatHistory.value;
  const targetIndices: number[] = [];

  for (let i = startIndex.value; i <= endIndex.value; i++) {
    const msg = history[i];
    if (msg.is_system) continue;

    const extra = msg.extra['core.chat-memory'];
    const hasSummary = !!extra?.summary;

    if (mode === 'force-all' || !hasSummary) {
      targetIndices.push(i);
    }
  }

  if (targetIndices.length === 0) {
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.errors.noMatchingMessages'), 'info');
    return;
  }

  const confirmMessage =
    mode === 'force-all'
      ? t('extensionsBuiltin.chatMemory.popups.summarizeRange.contentAll', { count: targetIndices.length })
      : t('extensionsBuiltin.chatMemory.popups.summarizeRange.contentMissing', { count: targetIndices.length });

  const { result } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.chatMemory.popups.summarizeRange.title'),
    content: confirmMessage,
    type: POPUP_TYPE.CONFIRM,
  });

  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  isGenerating.value = true;
  abortController.value = new AbortController();
  bulkProgress.value = { current: 0, total: targetIndices.length };

  try {
    for (const idx of targetIndices) {
      if (abortController.value?.signal.aborted) break;

      const msg = history[idx];
      const prompt = props.api.macro.process(messageSummaryPrompt.value, undefined, { text: msg.mes });

      const response = await props.api.llm.generate([{ role: 'system', content: prompt, name: 'System' }], {
        connectionProfile: props.connectionProfile,
      });

      let fullContent = '';
      if (Symbol.asyncIterator in response) {
        for await (const chunk of response) {
          fullContent += chunk.delta;
        }
      } else {
        fullContent = response.content;
      }

      const codeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
      const match = fullContent.match(codeBlockRegex);
      const text = match && match[1] ? match[1].trim() : fullContent.trim();

      await props.api.chat.updateMessageObject(idx, {
        extra: {
          'core.chat-memory': {
            summary: text,
          },
        },
      });

      bulkProgress.value.current++;
    }

    if (!abortController.value?.signal.aborted) {
      props.api.ui.showToast(t('extensionsBuiltin.chatMemory.success.summarizationComplete'), 'success');
    }
  } catch (error) {
    console.error('Range summarization error', error);
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.failed'), 'error');
  } finally {
    isGenerating.value = false;
    bulkProgress.value = null;
    abortController.value = null;
  }
}

async function clearRange() {
  if (!isValidRange.value) return;

  const count = countSummarizedInRange.value;
  if (count === 0) {
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.errors.noSummariesToClear'), 'info');
    return;
  }

  const { result } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.chatMemory.popups.clearRange.title'),
    content: t('extensionsBuiltin.chatMemory.popups.clearRange.content', { count }),
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.delete',
    cancelButton: 'common.cancel',
  });

  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  const history = chatHistory.value;
  let deletedCount = 0;

  for (let i = startIndex.value; i <= endIndex.value; i++) {
    const msg = history[i];
    const extra = msg.extra['core.chat-memory'];
    if (extra?.summary) {
      await props.api.chat.updateMessageObject(i, {
        extra: {
          'core.chat-memory': {
            summary: undefined,
          },
        },
      });
      deletedCount++;
    }
  }
  props.api.ui.showToast(t('extensionsBuiltin.chatMemory.success.cleared', { count: deletedCount }), 'success');
}

async function handleDeleteAll() {
  const { result } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.chatMemory.popups.deleteAll.title'),
    content: t('extensionsBuiltin.chatMemory.popups.deleteAll.content'),
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.delete',
    cancelButton: 'common.cancel',
  });

  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  const history = chatHistory.value;
  let count = 0;

  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    const extra = msg.extra?.['core.chat-memory'];
    if (extra?.summary) {
      await props.api.chat.updateMessageObject(i, {
        extra: {
          'core.chat-memory': {
            summary: undefined,
          },
        },
      });
      count++;
    }
  }
  props.api.ui.showToast(t('extensionsBuiltin.chatMemory.success.removedAll', { count }), 'success');
}

onMounted(() => {
  loadSettings();
});

onUnmounted(() => {
  if (abortController.value) {
    abortController.value.abort();
  }
});

watch(
  [enableMessageSummarization, autoMessageSummarize, messageSummaryPrompt, ignoreSummaryCount, startIndex, endIndex],
  () => {
    saveSettings();
  },
  { deep: true },
);
</script>

<template>
  <div class="message-summaries-tab">
    <div class="section">
      <div class="section-title">{{ t('extensionsBuiltin.chatMemory.settings.title') }}</div>
      <FormItem>
        <Toggle v-model="enableMessageSummarization" :label="t('extensionsBuiltin.chatMemory.settings.enable')" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.chatMemory.settings.autoLabel')"
        :description="t('extensionsBuiltin.chatMemory.settings.autoDesc')"
      >
        <Toggle
          v-model="autoMessageSummarize"
          :disabled="!enableMessageSummarization"
          :label="t('extensionsBuiltin.chatMemory.labels.autoTrigger')"
        />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.chatMemory.settings.ignoreCountLabel')"
        :description="t('extensionsBuiltin.chatMemory.settings.ignoreCountDesc')"
      >
        <Input v-model.number="ignoreSummaryCount" type="number" :min="0" />
      </FormItem>
      <FormItem
        :label="t('extensionsBuiltin.chatMemory.settings.promptLabel')"
        :description="t('extensionsBuiltin.chatMemory.settings.promptDesc')"
      >
        <Textarea
          v-model="messageSummaryPrompt"
          :rows="4"
          allow-maximize
          :tools="promptTools"
          identifier="extension.chat-memory.message-prompt"
        />
      </FormItem>
    </div>

    <div class="section highlight">
      <div class="section-title">{{ t('extensionsBuiltin.chatMemory.manageRange') }}</div>
      <TimelineVisualizer :total-items="maxIndex + 1" :segments="timelineSegments" />
      <div class="stats-row">
        <span>{{ t('extensionsBuiltin.chatMemory.stats.total', { count: messageStats.total }) }}</span>
        <span>{{ t('extensionsBuiltin.chatMemory.stats.summarized', { count: messageStats.summarized }) }}</span>
      </div>

      <div class="row">
        <FormItem :label="t('extensionsBuiltin.chatMemory.labels.startIndex')" style="flex: 1" :error="startIndexError">
          <Input v-model.number="startIndex" type="number" :min="0" :max="endIndex" />
        </FormItem>
        <FormItem :label="t('extensionsBuiltin.chatMemory.labels.endIndex')" style="flex: 1" :error="endIndexError">
          <Input v-model.number="endIndex" type="number" :min="startIndex" :max="maxIndex" />
        </FormItem>
      </div>

      <div v-if="bulkProgress" class="progress-bar">
        <div class="progress-fill" :style="{ width: (bulkProgress.current / bulkProgress.total) * 100 + '%' }"></div>
        <span class="progress-text">{{ bulkProgress.current }} / {{ bulkProgress.total }}</span>
      </div>

      <div class="actions">
        <template v-if="isGenerating">
          <Button variant="danger" icon="fa-stop" @click="cancelGeneration">
            {{ t('extensionsBuiltin.chatMemory.buttons.stop') }}
          </Button>
        </template>
        <template v-else>
          <Button
            variant="danger"
            icon="fa-eraser"
            :disabled="!isValidRange || countSummarizedInRange === 0"
            @click="clearRange"
          >
            {{ t('extensionsBuiltin.chatMemory.buttons.clearRange') }}
          </Button>
          <Button
            icon="fa-rotate"
            :disabled="
              !enableMessageSummarization || !connectionProfile || !isValidRange || countSummarizedInRange === 0
            "
            title="Re-summarize all messages in range, including existing ones"
            @click="summarizeRange('force-all')"
          >
            {{ t('extensionsBuiltin.chatMemory.buttons.resummarize') }}
          </Button>
          <Button
            icon="fa-wand-magic-sparkles"
            :disabled="
              !enableMessageSummarization || !connectionProfile || !isValidRange || countUnsummarizedInRange === 0
            "
            :title="`Summarize ${countUnsummarizedInRange} missing messages in range`"
            @click="summarizeRange('missing-only')"
          >
            {{ t('extensionsBuiltin.chatMemory.buttons.summarizeMissing') }}
          </Button>
        </template>
      </div>
    </div>

    <div class="section danger-zone">
      <div class="section-title">{{ t('extensionsBuiltin.chatMemory.globalActions') }}</div>
      <div class="actions">
        <Button variant="danger" icon="fa-trash-can" @click="handleDeleteAll">
          {{ t('extensionsBuiltin.chatMemory.buttons.deleteAll') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.message-summaries-tab {
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

.stats-row {
  display: flex;
  gap: 20px;
  font-size: 0.9em;
  color: var(--theme-emphasis-color);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin: 5px 0;
  flex-wrap: wrap;
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
</style>
