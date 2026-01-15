import { computed, nextTick, ref, watch } from 'vue';
import { useChatUiStore } from '../stores/chat-ui.store';
import { useChatStore } from '../stores/chat.store';
import { useSettingsStore } from '../stores/settings.store';

export function useChatView() {
  const chatStore = useChatStore();
  const chatUiStore = useChatUiStore();
  const settingsStore = useSettingsStore();

  const messagesContainer = ref<HTMLElement | null>(null);
  const shouldScrollInstant = ref(false);

  // --- Virtualization ---
  const visibleMessages = computed(() => {
    const allMessages = chatStore.activeChat?.messages || [];
    const limit = chatUiStore.renderedMessagesCount;
    const start = Math.max(0, allMessages.length - limit);

    return allMessages.slice(start).map((msg, index) => ({
      message: msg,
      index: start + index, // Real index in the store
    }));
  });

  const hasMoreMessages = computed(() => {
    const allMessages = chatStore.activeChat?.messages || [];
    return allMessages.length > chatUiStore.renderedMessagesCount;
  });

  function loadMoreMessages() {
    const el = messagesContainer.value;
    if (!el) return;

    const oldScrollHeight = el.scrollHeight;
    const oldScrollTop = el.scrollTop;

    const step = settingsStore.settings.ui.chat.messagesToLoad || 100;
    chatUiStore.loadMoreMessages(step);

    // Restore scroll position
    nextTick(() => {
      const newScrollHeight = el.scrollHeight;
      const diff = newScrollHeight - oldScrollHeight;
      el.scrollTop = oldScrollTop + diff;
    });
  }

  // --- Scrolling ---
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    nextTick(() => {
      const el = messagesContainer.value;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior });
      }
    });
  };

  const handleStreamingScroll = () => {
    const el = messagesContainer.value;
    if (!el) return;

    requestAnimationFrame(() => {
      // 100px tolerance
      const isScrolledToBottom = el.scrollHeight - el.clientHeight <= el.scrollTop + 100;

      if (isScrolledToBottom) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      }
    });
  };

  const lastMessageContent = computed(() => {
    const msgs = chatStore.activeChat?.messages;
    if (!msgs || msgs.length === 0) return '';
    return msgs[msgs.length - 1].mes;
  });

  // --- Watchers ---
  watch(
    visibleMessages,
    (newVal, oldVal) => {
      if (shouldScrollInstant.value) {
        scrollToBottom('auto');
        shouldScrollInstant.value = false;
        return;
      }

      const oldEnd = oldVal[oldVal.length - 1]?.index ?? -1;
      const newEnd = newVal[newVal.length - 1]?.index ?? -1;

      // New message added at the bottom
      if (newEnd > oldEnd) {
        scrollToBottom('smooth');
      }
    },
    { deep: false },
  );

  watch(lastMessageContent, () => {
    handleStreamingScroll();
  });

  watch(
    () => chatStore.activeChatFile,
    (newFile) => {
      if (newFile) {
        shouldScrollInstant.value = true;
      }
    },
  );

  return {
    messagesContainer,
    visibleMessages,
    hasMoreMessages,
    loadMoreMessages,
  };
}
