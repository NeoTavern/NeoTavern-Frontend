<script setup lang="ts">
import { useChatView } from '../../composables/useChatView';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useChatStore } from '../../stores/chat.store';
import { Button } from '../UI';
import ChatMessage from './ChatMessage.vue';

const chatStore = useChatStore();
const { t } = useStrictI18n();
const { visibleMessages, hasMoreMessages, loadMoreMessages, messagesContainer } = useChatView();

// Dummy log to avoid unused variable warning
console.debug(messagesContainer)
</script>

<template>
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
