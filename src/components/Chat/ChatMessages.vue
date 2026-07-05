<script setup lang="ts">
import { computed } from 'vue';
import { useChatView } from '../../composables/useChatView';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useChatUiStore } from '../../stores/chat-ui.store';
import { useChatStore } from '../../stores/chat.store';
import type { ChatMessage as ChatMessageType } from '../../types/chat';
import { Button } from '../UI';
import ChatMessage from './ChatMessage.vue';

const chatStore = useChatStore();
const chatUiStore = useChatUiStore();
const { t } = useStrictI18n();
const { visibleMessages, hasMoreMessages, loadMoreMessages, messagesContainer } = useChatView();

// Dummy log to avoid unused variable warning
console.debug(messagesContainer);

interface GroupedMessageItem {
  message: ChatMessageType;
  index: number;
  toolSteps?: { message: ChatMessageType; index: number }[];
}

const displayMessages = computed<GroupedMessageItem[]>(() => {
  const rawMessages = visibleMessages.value;
  if (!chatUiStore.mergeToolMessages) {
    return rawMessages;
  }

  const result: GroupedMessageItem[] = [];
  let currentGroup: { message: ChatMessageType; index: number }[] = [];

  const flushGroup = () => {
    if (currentGroup.length === 0) return;
    const lastItem = currentGroup[currentGroup.length - 1];
    const steps = currentGroup.slice(0, currentGroup.length - 1);
    result.push({
      message: lastItem.message,
      index: lastItem.index,
      toolSteps: steps,
    });
    currentGroup = [];
  };

  for (const item of rawMessages) {
    const msg = item.message;
    const isAssistant = !msg.is_user && !msg.is_system;
    const isSystem = msg.is_system;
    const hasToolCalls = msg.extra?.tool_invocations && msg.extra.tool_invocations.length > 0;

    if (currentGroup.length > 0) {
      if (isSystem) {
        // Assume system message following a tool call is a result
        currentGroup.push(item);
      } else if (isAssistant && hasToolCalls) {
        // Another tool call in the chain
        currentGroup.push(item);
      } else if (isAssistant && !hasToolCalls) {
        // Final message of the chain
        result.push({
          message: item.message,
          index: item.index,
          toolSteps: [...currentGroup],
        });
        currentGroup = [];
      } else {
        // Broken chain (e.g. User message or unexpected state)
        // Flush current group as a merged item
        flushGroup();
        // Push the current item
        result.push(item);
      }
    } else {
      if (isAssistant && hasToolCalls) {
        // Start of a tool chain
        currentGroup.push(item);
      } else {
        result.push(item);
      }
    }
  }

  // Flush any remaining items in group (e.g. if chat ends with tool output or currently generating)
  flushGroup();

  return result;
});
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

    <ChatMessage
      v-for="item in displayMessages"
      :key="item.index"
      :message="item.message"
      :index="item.index"
      :tool-steps="item.toolSteps"
    />
    <div
      v-show="chatStore.isGenerating"
      class="chat-interface-typing-indicator"
      role="status"
      :aria-label="t('chat.typingIndicator')"
    >
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
