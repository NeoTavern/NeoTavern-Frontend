<script setup lang="ts">
import { ref } from 'vue';
import { useChatStore } from '../../stores/chat.store';
import { useSettingsStore } from '../../stores/settings.store';
import ChatMessage from './ChatMessage.vue';

const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const userInput = ref('');

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
</script>

<template>
  <div class="chat-interface">
    <div class="chat-interface__messages">
      <ChatMessage v-for="(message, index) in chatStore.chat" :key="index" :message="message" :index="index" />
      <!-- TODO: Add typing indicator when chatStore.isGenerating is true -->
    </div>
    <div class="chat-interface__form-container">
      <form class="chat-form" @submit.prevent="submitMessage">
        <div class="chat-form__inner">
          <div class="chat-form__actions-left">
            <button type="button" class="chat-form__button fa-solid fa-bars" :title="$t('chat.options')"></button>
            <button
              type="button"
              class="chat-form__button fa-solid fa-magic-wand-sparkles"
              :title="$t('chat.extensions')"
            ></button>
          </div>
          <textarea
            id="chat-input"
            :placeholder="$t('chat.inputPlaceholder')"
            autocomplete="off"
            v-model="userInput"
            @keydown="handleKeydown"
            :disabled="chatStore.isGenerating"
          ></textarea>
          <div class="chat-form__actions-right">
            <button
              type="button"
              class="chat-form__button fa-fw fa-solid fa-arrow-right"
              :title="$t('chat.continue')"
              :disabled="chatStore.isGenerating"
            ></button>
            <button
              type="submit"
              class="chat-form__button fa-solid fa-paper-plane"
              :title="$t('chat.send')"
              :disabled="chatStore.isGenerating"
            ></button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>
