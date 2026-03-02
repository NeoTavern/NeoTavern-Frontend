<script setup lang="ts">
import { ref } from 'vue';
import type { ChatMessage, ExtensionAPI } from '../../../public-api';
import MessagePreview from './MessagePreview.vue';
import type { BookmarkManager } from './storage';
import type { Bookmark, BookmarkMetadata } from './types';

// onRenderTracked((event) => {
//   console.debug('onRenderTracked', event);
// })

// onRenderTriggered((event) => {
//   console.debug('onRenderTriggered', event);
// })

const newBookmarkTitle = ref('');
const newBookmarkMessageNum = ref(0);

const props = defineProps<{
  api: ExtensionAPI<unknown, BookmarkMetadata, unknown>;
  bookmarkManager: BookmarkManager;
}>();

function createBookmark(messageNum: number, title: string) {
  props.bookmarkManager.addBookmark({ messageNum, title });
  newBookmarkTitle.value = '';
  newBookmarkMessageNum.value = 0;
}

function deleteBookmark(messageNum: number, title: string) {
  props.bookmarkManager.removeBookmark({ messageNum, title });
}

function isChatLoaded() {
  return props.api.chat.isActive();
}

function isWithinHistory(bookmark: Bookmark): boolean {
  return bookmark.messageNum >= 0 && bookmark.messageNum < props.api.chat.getHistoryLength();
}

function getMessage(bookmark: Bookmark): ChatMessage {
  const message = props.api.chat.getMessage(bookmark.messageNum);
  if (!message) {
    throw new Error(`Message ${bookmark.messageNum} not found.`);
  }
  return message;
}
</script>

<template>
  <div>
    <h3 class="sidebar-header-main">Current Bookmarks</h3>
    <p v-if="!isChatLoaded()">No chat loaded.</p>
    <p v-else-if="bookmarkManager.length === 0">No bookmarks yet.</p>
    <ul v-else class="bookmark-list">
      <li
        v-for="bookmark in bookmarkManager.getBookmarks()"
        :key="bookmark.messageNum + bookmark.title"
        class="bookmark-item"
      >
        <div class="bookmark-header">
          <span class="message-id">#{{ bookmark.messageNum }}:</span>
          <span class="bookmark-title">{{ bookmark.title }}</span>
          <button
            type="button"
            name="deleteBookmark"
            class="bookmark-delete-button"
            title="Delete Bookmark"
            @click="deleteBookmark(bookmark.messageNum, bookmark.title)"
          >
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
        <MessagePreview v-if="isWithinHistory(bookmark)" :message="getMessage(bookmark)" class="bookmark-message" />
        <p v-else>Message #{{ bookmark.messageNum }} not found.</p>
      </li>
    </ul>
    <form
      v-if="isChatLoaded()"
      class="bookmark-form"
      @submit.prevent="createBookmark(newBookmarkMessageNum, newBookmarkTitle)"
    >
      <input v-model.number="newBookmarkMessageNum" type="text" name="messageNum" placeholder="0" required />
      <input v-model.trim="newBookmarkTitle" type="text" name="title" placeholder="Title" required />
      <button type="submit" name="addBookmark">Add Bookmark</button>
    </form>
  </div>
</template>

<style scoped lang="scss">
.bookmark-list {
  list-style: none;
  padding-inline-start: 0;
}
.bookmark-item {
  display: block;
  padding: var(--spacing-sm);
  border-radius: var(--base-border-radius);
}
.bookmark-item:hover {
  background-color: color-mix(in srgb, var(--theme-background-tint) 80%, var(--theme-text-color));
}
.bookmark-header {
  display: flex;
  justify-content: stretch;
  align-items: baseline;
  gap: var(--spacing-sm);
}
.bookmark-title {
  flex: 1 1 auto;
  font-weight: bold;
}
input[name='messageNum'] {
  width: 6ch;
}
input,
button {
  /* Is there a way to reduce this boilerplate? */
  color: var(--theme-text-color);
  background-color: var(--theme-background-tint);
}
.bookmark-delete-button {
  background: color(from var(--color-warning) srgb r g b / 0.2);
  border: thin solid var(--color-warning);
  border-radius: var(--base-border-radius);
}
</style>
