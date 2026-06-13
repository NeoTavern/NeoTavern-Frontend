import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useChatUiStore } from '../stores/chat-ui.store';
import { useChatStore } from '../stores/chat.store';
import { useSettingsStore } from '../stores/settings.store';

const BOTTOM_SCROLL_THRESHOLD = 100;

export function useChatView() {
  const chatStore = useChatStore();
  const chatUiStore = useChatUiStore();
  const settingsStore = useSettingsStore();

  const messagesContainer = ref<HTMLElement | null>(null);
  const shouldFollowStreaming = ref(true);
  const lastScrollTop = ref(0);
  let lastTouchY: number | null = null;

  const isNearBottom = (el: HTMLElement) =>
    el.scrollHeight - el.clientHeight - el.scrollTop <= BOTTOM_SCROLL_THRESHOLD;

  const pauseAutoScroll = () => {
    shouldFollowStreaming.value = false;
  };

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
        shouldFollowStreaming.value = true;
        lastScrollTop.value = el.scrollTop;
      }
    });
  };

  const followBottomAfterContentChange = (wasNearBottom: boolean, behavior: ScrollBehavior) => {
    if (!wasNearBottom && !shouldFollowStreaming.value) return;

    nextTick(() => {
      requestAnimationFrame(() => {
        const el = messagesContainer.value;
        if (!el || (!wasNearBottom && !shouldFollowStreaming.value)) return;

        el.scrollTo({ top: el.scrollHeight, behavior });
        shouldFollowStreaming.value = true;
        lastScrollTop.value = el.scrollTop;
      });
    });
  };

  const handleScroll = () => {
    const el = messagesContainer.value;
    if (!el) return;

    const isScrollingUp = el.scrollTop < lastScrollTop.value - 1;
    const isScrollingDown = el.scrollTop > lastScrollTop.value + 1;

    if (isScrollingUp) {
      pauseAutoScroll();
    }

    if (isScrollingDown && isNearBottom(el)) {
      shouldFollowStreaming.value = true;
    }

    lastScrollTop.value = el.scrollTop;
  };

  const handleWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) {
      pauseAutoScroll();
    }
  };

  const handleTouchStart = (event: TouchEvent) => {
    lastTouchY = event.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (event: TouchEvent) => {
    const touchY = event.touches[0]?.clientY;
    if (touchY === undefined || lastTouchY === null) return;

    if (touchY > lastTouchY) {
      pauseAutoScroll();
    }

    lastTouchY = touchY;
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
      const oldEnd = oldVal[oldVal.length - 1]?.index ?? -1;
      const newEnd = newVal[newVal.length - 1]?.index ?? -1;
      const newestMessage = newVal[newVal.length - 1]?.message;

      // New message added at the bottom
      if (newEnd > oldEnd && (newestMessage?.is_user || shouldFollowStreaming.value)) {
        scrollToBottom('smooth');
      }
    },
    { deep: false },
  );

  watch(lastMessageContent, () => {
    const el = messagesContainer.value;
    const wasNearBottom = el ? isNearBottom(el) : shouldFollowStreaming.value;

    followBottomAfterContentChange(wasNearBottom, chatStore.isGenerating ? 'smooth' : 'auto');
  });

  watch(
    () => chatStore.activeChatFile,
    (newFile) => {
      if (newFile) {
        scrollToBottom('auto');
      }
    },
    { flush: 'post' },
  );

  onMounted(() => {
    const el = messagesContainer.value;
    if (!el) return;

    lastScrollTop.value = el.scrollTop;
    shouldFollowStreaming.value = isNearBottom(el);
    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('wheel', handleWheel, { passive: true });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
  });

  onUnmounted(() => {
    const el = messagesContainer.value;
    if (!el) return;

    el.removeEventListener('scroll', handleScroll);
    el.removeEventListener('wheel', handleWheel);
    el.removeEventListener('touchstart', handleTouchStart);
    el.removeEventListener('touchmove', handleTouchMove);
  });

  return {
    messagesContainer,
    visibleMessages,
    hasMoreMessages,
    loadMoreMessages,
  };
}
