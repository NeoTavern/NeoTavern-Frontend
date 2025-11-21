<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="drawer-header">
    <div class="drawer-header-main">
      <h3 v-if="title">{{ title }}</h3>
      <slot name="title" />
    </div>
    <div class="drawer-header-actions">
      <slot name="actions" />
    </div>
  </div>
</template>
