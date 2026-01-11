<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { Button, FormItem, Input, Select, Textarea, Toggle } from '../../../components/UI';
import { useStrictI18n } from '../../../composables/useStrictI18n';
import type { ApiChatMessage, ChatMessage, ExtensionAPI } from '../../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types';
import type { WorldInfoEntry } from '../../../types/world-info';
import {
  DEFAULT_PROMPT,
  EXTENSION_KEY,
  type ExtensionSettings,
  type MemoryExtensionData,
  type MemoryMessageExtra,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<ExtensionSettings>;
}>();

// TODO: i18n

const { t } = useStrictI18n();

// --- State ---

const startIndex = ref<number>(0);
const endIndex = ref<number>(0);
const summaryResult = ref<string>('');
const isGenerating = ref(false);

// Persistent Settings
const connectionProfile = ref<string | undefined>(undefined);
const prompt = ref<string>(DEFAULT_PROMPT);
const autoHideMessages = ref(true);
const selectedLorebook = ref<string>('');

const availableLorebooks = ref<{ label: string; value: string }[]>([]);

// --- Computed ---

const chatHistory = computed(() => props.api.chat.getHistory());
const chatInfo = computed(() => props.api.chat.getChatInfo());

const maxIndex = computed(() => {
  const history = chatHistory.value;
  return history.length > 0 ? history.length - 1 : 0;
});

const isValidRange = computed(() => {
  return startIndex.value >= 0 && endIndex.value <= maxIndex.value && startIndex.value <= endIndex.value;
});

// --- Lifecycle ---

onMounted(async () => {
  // Initialize range to sensible defaults (e.g., last 20 messages or entire chat)
  endIndex.value = maxIndex.value;
  startIndex.value = Math.max(0, endIndex.value - 20);

  refreshLorebooks();
  loadSettings();
});

// Auto-save settings when specific fields change
watch(
  [connectionProfile, prompt, autoHideMessages, selectedLorebook],
  () => {
    saveSettings();
  },
  { deep: true },
);

// --- Methods ---

function loadSettings() {
  const settings = props.api.settings.get();

  if (settings) {
    if (settings.connectionProfile) connectionProfile.value = settings.connectionProfile;
    if (settings.prompt) prompt.value = settings.prompt;
    if (settings.autoHideMessages !== undefined) autoHideMessages.value = settings.autoHideMessages;
    if (settings.lastLorebook) {
      // Only set if it still exists in available books
      if (availableLorebooks.value.some((b) => b.value === settings.lastLorebook)) {
        selectedLorebook.value = settings.lastLorebook;
      }
    }
  }

  // Fallback for connection profile if not saved in extension settings: check global active profile
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
    prompt: prompt.value,
    autoHideMessages: autoHideMessages.value,
    lastLorebook: selectedLorebook.value,
  };
  props.api.settings.set(undefined, newSettings);
  props.api.settings.save();
}

function refreshLorebooks() {
  const books = props.api.worldInfo.getAllBookNames();
  availableLorebooks.value = books.map((b) => ({
    label: b.name,
    value: b.file_id,
  }));

  // If no persistent selection, try to select the currently active one
  if (!selectedLorebook.value) {
    const activeBooks = props.api.worldInfo.getActiveBookNames();
    if (activeBooks.length > 0) {
      selectedLorebook.value = activeBooks[0];
    } else if (availableLorebooks.value.length > 0) {
      selectedLorebook.value = availableLorebooks.value[0].value;
    }
  }
}

async function handleSummarize() {
  if (!connectionProfile.value) {
    props.api.ui.showToast(t('extensionsBuiltin.chatMemory.noProfile'), 'error');
    return;
  }

  if (!isValidRange.value) {
    props.api.ui.showToast('Invalid message range', 'error');
    return;
  }

  isGenerating.value = true;
  summaryResult.value = '';

  try {
    const messagesSlice = chatHistory.value.slice(startIndex.value, endIndex.value + 1);
    const textToSummarize = messagesSlice.map((m) => `${m.name}: ${m.mes}`).join('\n\n');

    const compiledPrompt = props.api.macro.process(prompt.value, undefined, {
      text: textToSummarize,
    });
    const messages: Array<ApiChatMessage> = [{ role: 'system', content: compiledPrompt, name: 'System' }];

    // Use streaming for better UX
    const response = await props.api.llm.generate(messages, {
      connectionProfileName: connectionProfile.value,
    });

    if (typeof response === 'function') {
      const generator = response();
      for await (const chunk of generator) {
        summaryResult.value += chunk.delta;
      }
    } else {
      summaryResult.value = response.content;
    }
  } catch (error) {
    console.error('Summarization failed', error);
    props.api.ui.showToast('Summarization failed', 'error');
  } finally {
    isGenerating.value = false;
  }
}

async function createEntry() {
  if (!selectedLorebook.value) {
    props.api.ui.showToast('Please select a Lorebook', 'error');
    return;
  }

  if (!summaryResult.value.trim()) {
    props.api.ui.showToast('Summary is empty', 'error');
    return;
  }

  const currentChatId = chatInfo.value?.file_id;
  if (!currentChatId) {
    props.api.ui.showToast('Chat ID not found', 'error');
    return;
  }

  try {
    // 1. Create Entry
    const extensionData: MemoryExtensionData = {
      chatId: currentChatId,
      range: [startIndex.value, endIndex.value],
      timestamp: Date.now(),
    };

    const newEntry: WorldInfoEntry = {
      ...props.api.worldInfo.createDefaultEntry(
        parseInt(props.api.uuid().replace(/\D/g, '').slice(0, 8)), // quick UID hack
      ),
      comment: `Memory: Msg ${startIndex.value}-${endIndex.value}`,
      content: summaryResult.value,
      constant: true,
      extensions: {
        [EXTENSION_KEY]: extensionData,
      },
    };

    await props.api.worldInfo.updateEntry(selectedLorebook.value, newEntry);

    // 2. Hide Messages / Mark Messages
    for (let i = startIndex.value; i <= endIndex.value; i++) {
      const msg = chatHistory.value[i];
      const extraUpdate: MemoryMessageExtra = {
        summarized: true,
        original_is_system: msg.is_system,
      };

      const updates: Partial<ChatMessage> = {
        extra: {
          ...msg.extra,
          [EXTENSION_KEY]: extraUpdate,
        },
      };

      if (autoHideMessages.value) {
        updates.is_system = true;
      }

      await props.api.chat.updateMessageObject(i, updates);
    }

    props.api.ui.showToast('Memory created and messages processed', 'success');
  } catch (error) {
    console.error('Failed to create memory entry', error);
    props.api.ui.showToast('Failed to create memory entry', 'error');
  }
}

async function handleReset() {
  const { result } = await props.api.ui.showPopup({
    title: 'Reset Memory',
    content:
      'This will remove all auto-generated memory entries for this chat and unhide the original messages. Are you sure?',
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.confirm',
    cancelButton: 'common.cancel',
  });

  if (result !== POPUP_RESULT.AFFIRMATIVE) return;

  const currentChatId = chatInfo.value?.file_id;
  if (!currentChatId) return;

  let restoredCount = 0;
  let entriesRemoved = 0;

  try {
    // 1. Restore Messages
    const history = chatHistory.value;
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      const memExtra = msg.extra?.[EXTENSION_KEY] as MemoryMessageExtra | undefined;

      if (memExtra && memExtra.summarized) {
        await props.api.chat.updateMessageObject(i, {
          is_system: memExtra.original_is_system ?? false,
          extra: {
            ...msg.extra,
            [EXTENSION_KEY]: undefined,
          },
        });
        restoredCount++;
      }
    }

    // 2. Remove Entries
    // Note: The API currently only exposes getting specific books or all book names.
    // We have to iterate books to find entries linked to this chat.
    // This is O(Books * Entries), which might be heavy, but necessary without an index.
    const bookNames = props.api.worldInfo.getAllBookNames();

    for (const header of bookNames) {
      const book = await props.api.worldInfo.getBook(header.name);
      if (!book) continue;

      let modified = false;
      const entriesToDisable: WorldInfoEntry[] = [];

      for (const entry of book.entries) {
        const extData = entry.extensions?.[EXTENSION_KEY] as MemoryExtensionData | undefined;
        if (extData && extData.chatId === currentChatId) {
          // We disable instead of deleting hard, as API support for delete might be varying or safer to archive
          if (!entry.disable) {
            const updatedEntry = { ...entry, disable: true, comment: entry.comment + ' (Archived)' };
            entriesToDisable.push(updatedEntry);
            modified = true;
          }
        }
      }

      if (modified) {
        for (const entry of entriesToDisable) {
          await props.api.worldInfo.updateEntry(header.name, entry);
          entriesRemoved++;
        }
      }
    }

    props.api.ui.showToast(
      `Reset complete. Restored ${restoredCount} messages, disabled ${entriesRemoved} entries.`,
      'success',
    );
  } catch (error) {
    console.error('Reset failed', error);
    props.api.ui.showToast('Reset failed', 'error');
  }
}
</script>

<template>
  <div class="memory-popup">
    <div class="section">
      <div class="section-title">1. {{ t('common.select') }} Range</div>
      <div class="row">
        <FormItem label="Start Index" style="flex: 1">
          <Input v-model.number="startIndex" type="number" :min="0" :max="endIndex" />
        </FormItem>
        <FormItem label="End Index" style="flex: 1">
          <Input v-model.number="endIndex" type="number" :min="startIndex" :max="maxIndex" />
        </FormItem>
      </div>
      <div class="info-text">Total Messages in Chat: {{ maxIndex + 1 }}</div>
    </div>

    <div class="section">
      <div class="section-title">2. Summarize</div>
      <FormItem label="Connection Profile">
        <ConnectionProfileSelector v-model="connectionProfile" />
      </FormItem>

      <FormItem label="Summarization Prompt">
        <Textarea v-model="prompt" :rows="4" />
      </FormItem>

      <div class="actions">
        <Button
          :loading="isGenerating"
          :disabled="!isValidRange || !connectionProfile"
          icon="fa-wand-magic-sparkles"
          @click="handleSummarize"
        >
          Generate Summary
        </Button>
      </div>

      <FormItem label="Result">
        <Textarea v-model="summaryResult" :rows="6" placeholder="Generated summary will appear here..." />
      </FormItem>
    </div>

    <div class="section highlight">
      <div class="section-title">3. Create Memory</div>

      <div class="row">
        <FormItem label="Target Lorebook" style="flex: 1">
          <Select v-model="selectedLorebook" :options="availableLorebooks" placeholder="Select a Lorebook" />
        </FormItem>
      </div>

      <FormItem>
        <Toggle v-model="autoHideMessages" label="Auto-hide messages (Set as System)" />
      </FormItem>

      <div class="actions">
        <Button variant="confirm" icon="fa-save" :disabled="!summaryResult || !selectedLorebook" @click="createEntry">
          Create Constant Entry & Hide Messages
        </Button>
      </div>
    </div>

    <div class="section danger-zone">
      <div class="section-title">Manage</div>
      <div class="actions">
        <Button variant="danger" icon="fa-rotate-left" @click="handleReset"> Reset Memories for Current Chat </Button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.memory-popup {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 10px;
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
  margin: 5px 0;
}

.info-text {
  font-size: 0.9em;
  color: var(--theme-emphasis-color);
  text-align: right;
}
</style>
