<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useChatStore } from '../../stores/chat.store';
import { useSettingsStore } from '../../stores/settings.store';
import ChatMessage from './ChatMessage.vue';
import ChatManagementPopup from './ChatManagementPopup.vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { GenerationMode } from '../../types';

const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const { t } = useStrictI18n();
const userInput = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const isOptionsMenuVisible = ref(false);
const optionsMenu = ref<HTMLElement | null>(null);
const isChatManagementPopupVisible = ref(false);

function submitMessage() {
  chatStore.sendMessage(userInput.value);
  userInput.value = '';
}

function regenerate() {
  chatStore.generateResponse(GenerationMode.REGENERATE);
  isOptionsMenuVisible.value = false;
}

function continueGeneration() {
  chatStore.generateResponse(GenerationMode.CONTINUE);
  isOptionsMenuVisible.value = false;
}

function openChatManagement() {
  isChatManagementPopupVisible.value = true;
  isOptionsMenuVisible.value = false;
}

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

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

// Watch for changes in the chat history to handle auto-scrolling.
watch(
  () => chatStore.chat,
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
</script>

<template>
  <div class="chat-interface">
    <div id="chat-messages-container" class="chat-interface__messages" ref="messagesContainer">
      <ChatMessage v-for="(message, index) in chatStore.chat" :key="index" :message="message" :index="index" />
      <div v-show="chatStore.isGenerating" class="chat-interface__typing-indicator">
        <span>{{ t('chat.typingIndicator') }}</span>
        <div class="dot dot1"></div>
        <div class="dot dot2"></div>
        <div class="dot dot3"></div>
      </div>
    </div>
    <div class="chat-interface__form-container">
      <form id="chat-form" class="chat-form" @submit.prevent="submitMessage">
        <div class="chat-form__inner">
          <div class="chat-form__actions-left">
            <button
              id="chat-options-button"
              type="button"
              class="chat-form__button fa-solid fa-bars"
              :title="t('chat.options')"
              @click.stop="isOptionsMenuVisible = !isOptionsMenuVisible"
            ></button>
            <button
              type="button"
              class="chat-form__button fa-solid fa-magic-wand-sparkles"
              :title="t('chat.extensions')"
            ></button>
          </div>
          <textarea
            id="chat-input"
            :placeholder="t('chat.inputPlaceholder')"
            autocomplete="off"
            v-model="userInput"
            @keydown="handleKeydown"
            :disabled="chatStore.isGenerating"
          ></textarea>
          <div class="chat-form__actions-right">
            <button
              v-show="chatStore.isGenerating"
              @click="chatStore.abortGeneration"
              type="button"
              class="chat-form__button fa-fw fa-solid fa-stop"
              :title="t('chat.abort')"
            ></button>
            <template v-show="!chatStore.isGenerating">
              <button
                @click="continueGeneration"
                type="button"
                class="chat-form__button fa-fw fa-solid fa-arrow-right"
                :title="t('chat.continue')"
                :disabled="chatStore.isGenerating"
              ></button>
              <button
                type="submit"
                class="chat-form__button fa-solid fa-paper-plane"
                :title="t('chat.send')"
                :disabled="chatStore.isGenerating"
              ></button>
            </template>
          </div>
        </div>

        <div v-show="isOptionsMenuVisible" ref="optionsMenu" class="options-menu">
          <!-- TODO: Add logic for these buttons -->
          <a class="options-menu__item" @click="openChatManagement">
            <i class="fa-solid fa-address-book"></i>
            <span>{{ t('chat.optionsMenu.manageChats') }}</span>
          </a>
          <hr />
          <a @click="regenerate" class="options-menu__item">
            <i class="fa-solid fa-repeat"></i>
            <span>{{ t('chat.optionsMenu.regenerate') }}</span>
          </a>
          <a @click="continueGeneration" class="options-menu__item">
            <i class="fa-solid fa-arrow-right"></i>
            <span>{{ t('chat.optionsMenu.continue') }}</span>
          </a>
        </div>
      </form>
    </div>
    <ChatManagementPopup :visible="isChatManagementPopupVisible" @close="isChatManagementPopupVisible = false" />
  </div>
</template>
