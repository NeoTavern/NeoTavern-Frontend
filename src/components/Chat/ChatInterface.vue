<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { listChats, listRecentChats } from '../../api/chat';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { GenerationMode } from '../../constants';
import { convertCharacterBookToWorldInfoBook } from '../../services/world-info';
import { useCharacterStore } from '../../stores/character.store';
import { useChatSelectionStore } from '../../stores/chat-selection.store';
import { useChatStore } from '../../stores/chat.store';
import { usePopupStore } from '../../stores/popup.store';
import { usePromptStore } from '../../stores/prompt.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useWorldInfoStore } from '../../stores/world-info.store';
import { POPUP_RESULT, POPUP_TYPE } from '../../types';
import { Button } from '../UI';
import ChatMessage from './ChatMessage.vue';

const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const characterStore = useCharacterStore();
const chatSelectionStore = useChatSelectionStore();
const worldInfoStore = useWorldInfoStore();
const popupStore = usePopupStore();
const promptStore = usePromptStore();
const { t } = useStrictI18n();
const userInput = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const isOptionsMenuVisible = ref(false);
const optionsMenu = ref<HTMLElement | null>(null);

function submitMessage() {
  if (!userInput.value.trim()) return;
  chatStore.sendMessage(userInput.value);
  userInput.value = '';

  if (chatStore.activeChatFile) {
    promptStore.clearUserTyping(chatStore.activeChatFile);
  }
}

function generate() {
  chatStore.generateResponse(GenerationMode.NEW);
  isOptionsMenuVisible.value = false;
}

function regenerate() {
  chatStore.generateResponse(GenerationMode.REGENERATE);
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
  if (optionsMenu.value && !optionsMenu.value.contains(event.target as Node)) {
    const optionsButton = document.getElementById('chat-options-button');
    if (optionsButton && !optionsButton.contains(event.target as Node)) {
      isOptionsMenuVisible.value = false;
    }
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

onMounted(async () => {
  document.addEventListener('click', handleClickOutside);

  // TODO: We should have a more centralized way to refresh chat lists.
  chatStore.chatInfos = await listChats();
  chatStore.recentChats = await listRecentChats();
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

watch(
  () => chatStore.activeChatFile,
  (newFile) => {
    if (newFile) {
      checkAndImportCharacterBooks();
    }
  },
);

// Watch for changes in the chat history to handle auto-scrolling.
watch(
  () => chatStore.activeChat,
  () => {
    const el = messagesContainer.value;
    if (!el) return;

    // Check if the user is near the bottom before the DOM updates.
    // A tolerance of 100px allows for some leeway.
    const isScrolledToBottom = el.scrollHeight - el.clientHeight <= el.scrollTop + 100;

    // If the user is at the bottom, scroll down after the next DOM update.
    if (isScrolledToBottom) {
      nextTick(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      });
    }
  },
  { deep: true }, // Deep watch is necessary to detect streaming updates inside a message.
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
    } else {
      userInput.value = '';
    }
  },
);
</script>

<template>
  <div class="chat-interface">
    <div v-show="chatStore.isChatLoading" class="chat-loading-overlay">
      <div class="loading-spinner">
        <i class="fa-solid fa-circle-notch fa-spin"></i>
        <span>{{ t('common.loading') }}</span>
      </div>
    </div>

    <div id="chat-messages-container" ref="messagesContainer" class="chat-interface-messages">
      <ChatMessage
        v-for="(message, index) in chatStore.activeChat?.messages"
        :key="index"
        :message="message"
        :index="index"
      />
      <div v-show="chatStore.isGenerating" class="chat-interface-typing-indicator">
        <span>{{ t('chat.typingIndicator') }}</span>
        <div class="dot dot1"></div>
        <div class="dot dot2"></div>
        <div class="dot dot3"></div>
      </div>
    </div>
    <div class="chat-interface-form-container">
      <!-- Standard Chat Form -->
      <div v-if="!chatSelectionStore.isSelectionMode" id="chat-form" class="chat-form">
        <div class="chat-form-inner">
          <div class="chat-form-actions-left">
            <Button
              id="chat-options-button"
              class="chat-form-button"
              variant="ghost"
              icon="fa-bars"
              :title="t('chat.options')"
              @click.stop="isOptionsMenuVisible = !isOptionsMenuVisible"
            />
          </div>
          <textarea
            id="chat-input"
            v-model="userInput"
            :placeholder="t('chat.inputPlaceholder')"
            autocomplete="off"
            :disabled="chatStore.isGenerating"
            @keydown="handleKeydown"
          ></textarea>
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

        <div v-show="isOptionsMenuVisible" ref="optionsMenu" class="options-menu">
          <a class="options-menu-item" @click="generate">
            <i class="fa-solid fa-paper-plane"></i>
            <span>{{ t('chat.optionsMenu.generate') }}</span>
          </a>
          <a class="options-menu-item" @click="regenerate">
            <i class="fa-solid fa-repeat"></i>
            <span>{{ t('chat.optionsMenu.regenerate') }}</span>
          </a>
          <a class="options-menu-item" @click="continueGeneration">
            <i class="fa-solid fa-arrow-right"></i>
            <span>{{ t('chat.optionsMenu.continue') }}</span>
          </a>
          <hr />
          <a class="options-menu-item" @click="toggleSelectionMode">
            <i class="fa-solid fa-check-double"></i>
            <span>{{ t('chat.optionsMenu.selectMessages') }}</span>
          </a>
        </div>
      </div>

      <!-- Selection Mode Toolbar -->
      <div v-else class="selection-toolbar">
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

<style scoped lang="scss">
.separator-vertical {
  width: 1px;
  background-color: var(--theme-border-color);
  height: 24px;
  margin: 0 4px;
}
</style>
