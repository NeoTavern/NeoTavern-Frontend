<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useChatStore } from '../../stores/chat.store';
import { useSettingsStore } from '../../stores/settings.store';
import ChatMessage from './ChatMessage.vue';
import { useStrictI18n } from '../../composables/useStrictI18n';

const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const { t } = useStrictI18n();
const userInput = ref('');
const messagesContainer = ref<HTMLElement | null>(null);

function submitMessage() {
  chatStore.sendMessage(userInput.value);
  userInput.value = '';
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && settingsStore.shouldSendOnEnter) {
    event.preventDefault();
    submitMessage();
  }
}

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
      <!-- TODO: Add typing indicator when chatStore.isGenerating is true -->
    </div>
    <div class="chat-interface__form-container">
      <form id="chat-form" class="chat-form" @submit.prevent="submitMessage">
        <div class="chat-form__inner">
          <div class="chat-form__actions-left">
            <button type="button" class="chat-form__button fa-solid fa-bars" :title="t('chat.options')"></button>
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
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
