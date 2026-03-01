<script setup lang="ts">
import type { Bookmark } from './types';

/*const props = */defineProps<{
  bookmarks: Bookmark[];
}>();
</script>

<template>
  <div>
    <h1>Current Bookmarks</h1>
    <ul>
      <li v-for="bookmark in bookmarks">
        #{{ bookmark.messageNum }}: {{ bookmark.title }}
      </li>
    </ul>
  </div>
</template>
