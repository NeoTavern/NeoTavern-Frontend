<script setup lang="ts">
import { ref } from 'vue';
import type { ChatMessage } from '../../../types/chat';

const props = defineProps<{
  message: ChatMessage;
}>();

const isOpen = ref(false);

const MULTILINE_MESSAGE_LENGTH = 120;
</script>

<template>
  <div class="message-preview-container" :class="{ 'is-user': message.is_user, 'is-bot': !message.is_user }">
    <label class="open-preview-toggle">
      <input type="checkbox" v-model="isOpen" />
      <div class="open-preview-toggle-gutter"></div>
    </label>
    <details class="message-preview" :open="isOpen">
      <summary>
        <span class="summary-first-line">
          <span class="message-name">{{ message.name }}:</span>
          <span class="message-begins">{{ message.mes }}</span>
          <span class="message-timestamp">{{ message.send_date }}</span>
        </span>
        <span class="message-ends" v-if="message.mes.length > MULTILINE_MESSAGE_LENGTH">{{ message.mes }}</span>
      </summary>
      <article class="message-content">{{ message.mes }}</article>
    </details>
  </div>
</template>

<style lang="css" scoped>
.message-name {
  flex: 0 0 auto;
}
.message-timestamp {
  display: none; /* only visible when expanded */
  margin-left: auto; /* push to the right */
}
.message-preview[open] .message-timestamp {
  display: inline;
}
.message-begins {
  flex: 1 1 12em; /* a small minimum size so it usually shares a line with the name */
  display: inline flow-root;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.message-ends {
  display: inline flow-root;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl; /* hack to get text-overflow to show us the end of the message. */
}
.summary-first-line {
  display: block flex;
  gap: 1ch;
  max-width: 100%;
  flex-wrap: wrap; /* usually one line, but can wrap if the message gets real squished */
}
.message-preview summary {
  display: block;
  cursor: default; /* so it looks more like button than text */
}
.message-preview-container {
  display: block flex;
  align-items: stretch;
  width: 100%;
}
.open-preview-toggle {
  flex: 0 0 auto;
}
.open-preview-toggle-gutter {
  display: block;
  height: 100%;
  width: var(--spacing-xs);
  margin: var(--spacing-xs) var(--spacing-md) var(--spacing-xs) var(--spacing-xs);

  .is-user & {
    background: var(--theme-quote-color-user);
  }
  .is-bot & {
    background: var(--theme-quote-color);
  }
}
.open-preview-toggle input {
  visibility: hidden;
  position: absolute;
}
.message-preview {
  flex: 1 1 0;
  width: 0; /* start small and grow to container size */
}
.message-preview[open] .message-begins,
.message-preview[open] .message-ends {
  display: none;
}
.message-content {
  white-space: pre-wrap; /* we're not running it through the markdown formatter, so just preserve line breaks */
}
.is-user .message-content {
  background-color: var(--theme-user-message-tint);
}
.is-bot .message-content {
  background-color: var(--theme-bot-message-tint);
}
</style>
