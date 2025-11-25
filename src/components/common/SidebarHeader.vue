<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="sidebar-header">
    <div class="sidebar-header-main">
      <h3 v-if="title">{{ title }}</h3>
      <slot name="title" />
    </div>
    <div class="sidebar-header-actions">
      <slot name="actions" />
    </div>
  </div>
</template>
