<script setup lang="ts">
defineProps<{
  icon?: string;
  title?: string;
  description?: string;
}>();
</script>

<template>
  <div class="empty-state">
    <i v-if="icon" :class="['empty-state-icon', 'fa-solid', icon]"></i>
    <h2 v-if="title" class="empty-state-title">{{ title }}</h2>
    <p v-if="description" class="empty-state-text">{{ description }}</p>
    <div v-if="$slots.default" class="empty-state-actions">
      <slot />
    </div>
  </div>
</template>
