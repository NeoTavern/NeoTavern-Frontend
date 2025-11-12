<script setup lang="ts">
import type { PropType } from 'vue';
import type { Toast } from '../../composables/useToast';
import ToastMessage from './ToastMessage.vue';

defineProps({
  toasts: {
    type: Array as PropType<Toast[]>,
    required: true,
  },
});
</script>

<template>
  <div id="toast-container" class="toast-top-center">
    <ToastMessage v-for="toast in toasts" :key="toast.id" :toast="toast" />
  </div>
</template>
