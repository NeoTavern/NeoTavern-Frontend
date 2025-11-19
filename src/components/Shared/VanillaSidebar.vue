<script setup lang="ts">
// This component serves as a container for Vanilla JS extensions
// that want to manipulate the DOM directly without using Vue components.
defineProps<{
  id: string;
}>();
</script>

<template>
  <div :id="id" class="vanilla-sidebar-container">
    <!-- Vanilla extensions will append content here via document.getElementById(id) -->
  </div>
</template>

<style scoped>
.vanilla-sidebar-container {
  height: 100%;
  width: 100%;
  min-height: 100px;
}
</style>
