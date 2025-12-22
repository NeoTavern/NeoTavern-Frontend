<script setup lang="ts">
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useMobile } from '../../composables/useMobile';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { GenerationMode } from '../../constants';
import { convertCharacterBookToWorldInfoBook } from '../../services/world-info';
import { useCharacterStore } from '../../stores/character.store';
import { useChatSelectionStore } from '../../stores/chat-selection.store';
import { useChatUiStore } from '../../stores/chat-ui.store';
import { useChatStore } from '../../stores/chat.store';
import { useLayoutStore } from '../../stores/layout.store';
import { usePopupStore } from '../../stores/popup.store';
import { usePromptStore } from '../../stores/prompt.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useWorldInfoStore } from '../../stores/world-info.store';
import { POPUP_RESULT, POPUP_TYPE } from '../../types';
import { Button, Textarea } from '../UI';
import ChatMessage from './ChatMessage.vue';

const chatStore = useChatStore();
const chatUiStore = useChatUiStore();
const settingsStore = useSettingsStore();
const characterStore = useCharacterStore();
const chatSelectionStore = useChatSelectionStore();
const worldInfoStore = useWorldInfoStore();
const popupStore = usePopupStore();
const promptStore = usePromptStore();
const { isDeviceMobile, isViewportMobile } = useMobile();
const layoutStore = useLayoutStore();
const { t } = useStrictI18n();

const userInput = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const chatInput = ref<InstanceType<typeof Textarea> | null>(null);

const isOptionsMenuVisible = ref(false);
const optionsButtonRef = ref<HTMLElement | null>(null);
const optionsMenuRef = ref<HTMLElement | null>(null);
const shouldScrollInstant = ref(false);

const { floatingStyles: optionsMenuStyles } = useFloating(optionsButtonRef, optionsMenuRef, {
  placement: 'top-start',
  open: isOptionsMenuVisible,
  whileElementsMounted: autoUpdate,
  middleware: [offset(8), flip(), shift({ padding: 10 })],
});

function submitMessage() {
  if (!userInput.value.trim()) {
    generate();
    return;
  }
  chatStore.sendMessage(userInput.value);
  userInput.value = '';

  nextTick(() => {
    chatInput.value?.focus();
  });

  if (chatStore.activeChatFile) {
    promptStore.clearUserTyping(chatStore.activeChatFile);
  }
}

function generate() {
  chatStore.generateResponse(GenerationMode.NEW);
  isOptionsMenuVisible.value = false;
}

function regenerate() {
  const isLastMessageUser = chatStore.activeChat?.messages.slice(-1)[0]?.is_user;
  if (isLastMessageUser) {
    chatStore.generateResponse(GenerationMode.NEW);
  } else {
    chatStore.generateResponse(GenerationMode.REGENERATE);
  }
  isOptionsMenuVisible.value = false;
}

function continueGeneration() {
  chatStore.generateResponse(GenerationMode.CONTINUE);
  isOptionsMenuVisible.value = false;
}

function toggleSelectionMode() {
  chatSelectionStore.toggleSelectionMode();
  isOptionsMenuVisible.value = false;
}

function toggleSelectionType() {
  const newType = chatSelectionStore.selectionModeType === 'free' ? 'range' : 'free';
  chatSelectionStore.setSelectionType(newType);
}

const selectionModeIcon = computed(() =>
  chatSelectionStore.selectionModeType === 'free' ? 'fa-hand-pointer' : 'fa-arrow-down-long',
);

const selectionModeTitle = computed(() =>
  chatSelectionStore.selectionModeType === 'free' ? t('chat.selection.modeFree') : t('chat.selection.modeRange'),
);

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && settingsStore.shouldSendOnEnter) {
    event.preventDefault();
    submitMessage();
  }
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node;

  const isOutsideMenu = optionsMenuRef.value && !optionsMenuRef.value.contains(target);
  const isOutsideButton = optionsButtonRef.value && !optionsButtonRef.value.contains(target);

  if (isOutsideMenu && isOutsideButton) {
    isOptionsMenuVisible.value = false;
  }
}

async function checkAndImportCharacterBooks() {
  const members = chatStore.activeChat?.metadata.members || [];
  for (const member of members) {
    const character = characterStore.characters.find((c) => c.avatar === member);
    if (character?.data?.character_book?.name) {
      const bookName = character.data.character_book.name;
      const exists = worldInfoStore.bookInfos.find((b) => b.name === bookName);
      if (!exists) {
        const { result } = await popupStore.show({
          title: t('worldInfo.popup.importEmbeddedTitle'),
          content: t('worldInfo.popup.importEmbeddedContent', { name: bookName }),
          type: POPUP_TYPE.CONFIRM,
        });

        if (result === POPUP_RESULT.AFFIRMATIVE) {
          const book = convertCharacterBookToWorldInfoBook(character.data.character_book);
          await worldInfoStore.createBook(book.name, book);
          toast.success(t('worldInfo.importSuccess', { name: bookName }));
        }
      }
    }
  }
}

const lastMessageContent = computed(() => {
  const msgs = chatStore.activeChat?.messages;
  if (!msgs || msgs.length === 0) return '';
  return msgs[msgs.length - 1].mes;
});

// Virtualization Logic
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

// Scroll watcher
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

// Streaming content watcher
watch(lastMessageContent, () => {
  handleStreamingScroll();
});

onMounted(async () => {
  document.addEventListener('click', handleClickOutside);
  nextTick().then(() => {
    if (!isDeviceMobile.value) {
      chatInput.value?.focus();
    }

    const el = document.getElementById('chat-input');
    if (el) {
      const textarea = el.tagName === 'TEXTAREA' ? (el as HTMLTextAreaElement) : el.querySelector('textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        chatUiStore.setChatInputElement(textarea);
      }
    }
  });
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  chatUiStore.setChatInputElement(null);
});

watch(
  () => chatStore.activeChatFile,
  (newFile) => {
    if (newFile) {
      shouldScrollInstant.value = true;
      checkAndImportCharacterBooks();
    }
  },
);

watch(
  () => userInput.value,
  (newInput) => {
    if (chatStore.activeChatFile) {
      promptStore.saveUserTyping(chatStore.activeChatFile, newInput);
    }
  },
  { flush: 'post' },
);

watch(
  () => chatStore.activeChatFile,
  async (newFile, oldFile) => {
    if (oldFile) {
      await promptStore.clearUserTyping(oldFile);
    }

    if (newFile) {
      const savedInput = await promptStore.loadUserTyping(newFile);
      userInput.value = savedInput;

      if (!isDeviceMobile.value) {
        await nextTick();
        chatInput.value?.focus();
      }
    } else {
      userInput.value = '';
    }
  },
);
</script>

<template>
  <div class="chat-interface">
    <div v-show="chatStore.isChatLoading" class="chat-loading-overlay" role="alert" aria-busy="true">
      <div class="loading-spinner">
        <i class="fa-solid fa-circle-notch fa-spin"></i>
        <span>{{ t('common.loading') }}</span>
      </div>
    </div>

    <div
      id="chat-messages-container"
      ref="messagesContainer"
      class="chat-interface-messages"
      role="log"
      :aria-label="t('chat.itemization.chatHistory')"
      aria-live="polite"
    >
      <div v-if="hasMoreMessages" class="chat-load-more-container">
        <Button class="load-more-btn" variant="ghost" @click="loadMoreMessages">
          <i class="fa-solid fa-arrow-up"></i>
          {{ t('chat.loadMoreMessages') }}
        </Button>
      </div>

      <ChatMessage v-for="item in visibleMessages" :key="item.index" :message="item.message" :index="item.index" />
      <div v-show="chatStore.isGenerating" class="chat-interface-typing-indicator" role="status" aria-label="Typing">
        <span>{{ t('chat.typingIndicator') }}</span>
        <div class="dot dot1"></div>
        <div class="dot dot2"></div>
        <div class="dot dot3"></div>
      </div>
    </div>
    <div class="chat-interface-form-container">
      <!-- Standard Chat Form -->
      <div
        v-show="
          !chatSelectionStore.isSelectionMode &&
          (isViewportMobile ? !layoutStore.isLeftSidebarOpen && !layoutStore.isRightSidebarOpen : true)
        "
        id="chat-form"
        class="chat-form"
      >
        <div class="chat-form-inner">
          <div ref="optionsButtonRef" class="chat-form-actions-left">
            <Button
              id="chat-options-button"
              class="chat-form-button"
              variant="ghost"
              icon="fa-bars"
              :title="t('chat.options')"
              aria-haspopup="menu"
              :aria-expanded="isOptionsMenuVisible"
              @click.stop="isOptionsMenuVisible = !isOptionsMenuVisible"
            />
          </div>
          <Textarea
            id="chat-input"
            ref="chatInput"
            v-model="userInput"
            :placeholder="t('chat.inputPlaceholder')"
            autocomplete="off"
            :disabled="chatStore.isGenerating"
            :allow-maximize="false"
            identifier="chat.input"
            @keydown="handleKeydown"
          />
          <div class="chat-form-actions-right">
            <Button
              v-show="chatStore.isGenerating"
              class="chat-form-button"
              variant="ghost"
              icon="fa-stop"
              :title="t('chat.abort')"
              @click="chatStore.abortGeneration"
            />
            <div v-show="!chatStore.isGenerating" style="display: contents">
              <Button
                class="chat-form-button"
                icon="fa-paper-plane"
                variant="ghost"
                :title="t('chat.send')"
                :disabled="chatStore.isGenerating"
                @click="submitMessage"
              />
            </div>
          </div>
        </div>

        <div
          v-show="isOptionsMenuVisible"
          ref="optionsMenuRef"
          class="options-menu"
          :style="optionsMenuStyles"
          role="menu"
          aria-labelledby="chat-options-button"
        >
          <a
            class="options-menu-item"
            role="menuitem"
            tabindex="0"
            @click="regenerate"
            @keydown.enter.prevent="regenerate"
            @keydown.space.prevent="regenerate"
          >
            <i class="fa-solid fa-repeat"></i>
            <span>{{ t('chat.optionsMenu.regenerate') }}</span>
          </a>
          <a
            class="options-menu-item"
            role="menuitem"
            tabindex="0"
            @click="continueGeneration"
            @keydown.enter.prevent="continueGeneration"
            @keydown.space.prevent="continueGeneration"
          >
            <i class="fa-solid fa-arrow-right"></i>
            <span>{{ t('chat.optionsMenu.continue') }}</span>
          </a>
          <hr role="separator" />
          <a
            class="options-menu-item"
            role="menuitem"
            tabindex="0"
            @click="toggleSelectionMode"
            @keydown.enter.prevent="toggleSelectionMode"
            @keydown.space.prevent="toggleSelectionMode"
          >
            <i class="fa-solid fa-check-double"></i>
            <span>{{ t('chat.optionsMenu.selectMessages') }}</span>
          </a>
        </div>
      </div>

      <!-- Selection Mode Toolbar -->
      <div
        v-show="chatSelectionStore.isSelectionMode"
        class="selection-toolbar"
        role="toolbar"
        :aria-label="t('chat.selection.toolbar')"
      >
        <div class="selection-info">
          <span
            >{{ chatSelectionStore.selectedMessageIndices.size }} {{ t('common.selected') }} ({{
              t('chat.delete.plusOne')
            }})
          </span>
        </div>
        <div class="selection-actions">
          <!-- Selection Mode Toggle -->
          <Button
            :icon="selectionModeIcon"
            variant="ghost"
            :title="selectionModeTitle"
            active
            @click="toggleSelectionType"
          />

          <div class="separator-vertical"></div>

          <Button variant="ghost" :title="t('common.selectAll')" @click="chatSelectionStore.selectAll">
            {{ t('common.selectAll') }}
          </Button>
          <Button variant="ghost" :title="t('common.none')" @click="chatSelectionStore.deselectAll">
            {{ t('common.none') }}
          </Button>
          <Button variant="danger" icon="fa-trash" @click="chatStore.deleteSelectedMessages">
            {{ t('common.delete') }}
          </Button>
          <Button variant="ghost" icon="fa-xmark" @click="toggleSelectionMode">
            {{ t('common.cancel') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-load-more-container {
  display: flex;
  justify-content: center;
  margin-bottom: var(--spacing-md);
}

.load-more-btn {
  opacity: 0.7;
  transition: opacity 0.2s;
}

.load-more-btn:hover {
  opacity: 1;
}
</style>
