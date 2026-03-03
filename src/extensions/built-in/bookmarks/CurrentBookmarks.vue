<script setup lang="ts">
import { ref, useId, useTemplateRef, watch } from 'vue';
import type { ChatMessage, ExtensionAPI } from '../../../public-api';
import { additionalConstraint } from './form-help';
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

const t = props.api.i18n.t;

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

const messageNumInput = useTemplateRef('messageNumInput');
const messageNumInputId = useId();
const titleInputId = useId();

/** Validate the number is within range, after the native validation has passed. */
const validateMessageNum = additionalConstraint(messageNumInput, (value: number) => {
  const historyLength = props.api.chat.getHistoryLength();
  if (value >= historyLength) {
    return {
      valid: false,
      message: t('extensionsBuiltin.bookmarks.validationMessageCountMax', { count: historyLength }),
    };
  }
  return { valid: true };
});

watch<number>(newBookmarkMessageNum, validateMessageNum);
</script>

<template>
  <div>
    <h3 class="sidebar-header-main">{{ t('extensionsBuiltin.bookmarks.header') }}</h3>
    <p v-if="!isChatLoaded()">{{ t('extensionsBuiltin.bookmarks.noChatLoaded') }}</p>
    <p v-else-if="bookmarkManager.length === 0">{{ t('extensionsBuiltin.bookmarks.noBookmarksYet') }}</p>
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
            :title="t('extensionsBuiltin.bookmarks.deleteBookmark')"
            @click="deleteBookmark(bookmark.messageNum, bookmark.title)"
          >
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
        <MessagePreview v-if="isWithinHistory(bookmark)" :message="getMessage(bookmark)" class="bookmark-message" />
        <p v-else class="bookmark-message-not-found">
          {{ t('extensionsBuiltin.bookmarks.messageNotFound', { num: bookmark.messageNum }) }}
        </p>
      </li>
    </ul>
    <form
      v-if="isChatLoaded()"
      class="bookmark-form"
      @submit.prevent="createBookmark(newBookmarkMessageNum, newBookmarkTitle)"
    >
      <div class="label-input-group">
        <span style="text-wrap: nowrap">
          <!-- Prepend the # character to the input -->
          <span style="margin-right: -1.5ch; pointer-events: none; position: relative; z-index: 2">#</span
          ><!-- messageNum input type text instead of number because it doesn't really make sense to have
       step increment controls. --><input
            :id="messageNumInputId"
            ref="messageNumInput"
            v-model.number="newBookmarkMessageNum"
            :title="t('extensionsBuiltin.bookmarks.messageNumberLabel')"
            type="text"
            name="messageNum"
            :placeholder="t('extensionsBuiltin.bookmarks.messageNumberPlaceholder')"
            size="3"
            inputmode="numeric"
            pattern="[0-9]+"
            autocomplete="off"
            required
            class="text-pole"
          />
        </span>
        <label :for="messageNumInputId">{{ t('extensionsBuiltin.bookmarks.messageNumberLabel') }}</label>
      </div>
      <div class="label-input-group">
        <input
          :id="titleInputId"
          v-model.trim="newBookmarkTitle"
          :title="t('extensionsBuiltin.bookmarks.titleLabel')"
          type="text"
          name="title"
          :placeholder="t('extensionsBuiltin.bookmarks.titlePlaceholder')"
          required
          class="text-pole"
        />
        <label :for="titleInputId">{{ t('extensionsBuiltin.bookmarks.titleLabel') }}</label>
      </div>
      <button type="submit" name="addBookmark" class="menu-button">
        <span><i class="fa-solid fa-plus"></i> {{ t('extensionsBuiltin.bookmarks.addBookmark') }}</span>
      </button>
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
.bookmark-message-not-found {
  color: var(--color-warning-amber);
  font-style: italic;
  margin-left: var(--spacing-lg);
}

.bookmark-delete-button {
  background: color(from var(--color-warning) srgb r g b / 0.2);
  border: thin solid var(--color-warning);
  border-radius: var(--base-border-radius);
}

/* Add Bookmark Form */
.bookmark-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs);
  margin: var(--spacing-sm);

  .label-input-group {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);

    label {
      font-size: 0.9em;
    }
  }

  .label-input-group:has(input[name='messageNum']) {
    flex: 0 1 auto;

    input[name='messageNum'] {
      text-align: right;
      width: unset; /* undo .text-pole's width 100% */
    }

    width: min-content;
  }
  .label-input-group:has(input[name='title']) {
    flex: auto;
  }
  button[name='addBookmark'] {
    flex: 0 1 min-content;
  }
}
</style>
