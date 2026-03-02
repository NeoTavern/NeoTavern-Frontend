<script setup lang="ts">
import type { ChatMessage } from '../../../types/chat';

const props = defineProps<{
  message: ChatMessage;
}>();
</script>

<template>
  <details class="message-preview" :class="{ 'is-user': message.is_user, 'is-bot': !message.is_user }">
    <summary>
      <span class="first-line">
        <span class="message-name">{{ message.name }}:</span>
        <span class="message-begins">{{ message.mes }}</span>
        <span class="message-timestamp">{{ message.send_date }}</span>
      </span>
      <span class="message-ends" v-if="message.mes.length > 100">{{ message.mes }}</span>
    </summary>
    <article class="message-content">{{ message.mes }}</article>
  </details>
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
.first-line {
  display: block flex;
  gap: 1ch;
  max-width: 100%;
  flex-wrap: wrap; /* usually one line, but can wrap if the message gets real squished */
}
.message-preview summary {
  display: block;
  cursor: pointer;
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
