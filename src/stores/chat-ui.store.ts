import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Settings } from '../types';
import { useSettingsStore } from './settings.store';

export type QuickActionsLayout = Settings['chat']['quickActions']['layout'];

export interface ChatMessageEditState {
  index: number;
  originalContent: string;
}

export const useChatUiStore = defineStore('chat-ui', () => {
  const isChatLoading = ref(false);
  const activeMessageEditState = ref<ChatMessageEditState | null>(null);
  const renderedMessagesCount = ref(100);
  const chatInputElement = ref<HTMLTextAreaElement | null>(null);

  // --- Quick Actions Proxies to Settings ---
  const settingsStore = useSettingsStore();

  const quickActionsLayout = computed(() => settingsStore.settings.chat.quickActions.layout);
  const quickActionsShowLabels = computed(() => settingsStore.settings.chat.quickActions.showLabels);

  function setQuickActionsLayout(layout: QuickActionsLayout) {
    settingsStore.setSetting('chat.quickActions.layout', layout);
  }

  function setQuickActionsShowLabels(show: boolean) {
    settingsStore.setSetting('chat.quickActions.showLabels', show);
  }

  function isQuickActionDisabled(id: string): boolean {
    return settingsStore.settings.chat.quickActions.disabledActions.includes(id);
  }

  function toggleQuickAction(id: string) {
    const currentDisabled = settingsStore.settings.chat.quickActions.disabledActions;
    const newDisabled = [...currentDisabled];
    const index = newDisabled.indexOf(id);

    if (index > -1) {
      newDisabled.splice(index, 1);
    } else {
      newDisabled.push(id);
    }
    settingsStore.setSetting('chat.quickActions.disabledActions', newDisabled);
  }

  // --- Other functions ---

  function startEditing(index: number, content: string) {
    activeMessageEditState.value = {
      index,
      originalContent: content,
    };
  }

  function cancelEditing() {
    activeMessageEditState.value = null;
  }

  function resetRenderedMessagesCount(initialCount: number) {
    renderedMessagesCount.value = initialCount;
  }

  function loadMoreMessages(count: number) {
    renderedMessagesCount.value += count;
  }

  function setChatInputElement(el: HTMLTextAreaElement | null) {
    chatInputElement.value = el;
  }

  return {
    isChatLoading,
    activeMessageEditState,
    renderedMessagesCount,
    chatInputElement,

    // Quick Actions
    quickActionsLayout,
    quickActionsShowLabels,
    setQuickActionsLayout,
    setQuickActionsShowLabels,
    isQuickActionDisabled,
    toggleQuickAction,

    startEditing,
    cancelEditing,
    resetRenderedMessagesCount,
    loadMoreMessages,
    setChatInputElement,
  };
});
