<script setup lang="ts">
import { onMounted } from 'vue';
import SidebarHeader from '../common/SidebarHeader.vue';

const props = defineProps<{
  id: string;
  title?: string;
}>();

const emit = defineEmits(['ready']);

onMounted(() => {
  // Since sidebars are now lazy-loaded, we must inform extensions when the DOM is actually ready.
  // Vanilla extensions listening for window load will fail because this component mounts later.
  // Dispatch a custom event globally.
  window.dispatchEvent(
    new CustomEvent(`sidebar:${props.id}:mounted`, {
      detail: { containerId: props.id },
    }),
  );

  emit('ready');
});
</script>

<template>
  <div class="vanilla-sidebar-wrapper">
    <SidebarHeader v-if="title" :title="title">
      <template #actions>
        <!-- Extensions can inject header actions here -->
        <div :id="`${id}-header-actions`" class="vanilla-sidebar-header-actions"></div>
      </template>
    </SidebarHeader>

    <div :id="id" class="vanilla-sidebar-container">
      <!-- Vanilla extensions will append content here via document.getElementById(id) -->
    </div>
  </div>
</template>
