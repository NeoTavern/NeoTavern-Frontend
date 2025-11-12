<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { PropType } from 'vue';
import { toast, type Toast } from '../../composables/useToast';

const props = defineProps({
  toast: {
    type: Object as PropType<Toast>,
    required: true,
  },
});

const isVisible = ref(false);

onMounted(() => {
  // Animate in
  requestAnimationFrame(() => {
    isVisible.value = true;
  });

  // Set timeout to auto-remove
  if (props.toast.timeout && props.toast.timeout > 0) {
    setTimeout(() => {
      hide();
    }, props.toast.timeout);
  }
});

function hide() {
  isVisible.value = false;
  // Wait for animation to finish before removing from store
  setTimeout(() => {
    toast.remove(props.toast.id);
  }, 300); // Corresponds to transition duration
}
</script>

<template>
  <div class="toast" :class="[`toast-${props.toast.type}`, { show: isVisible }]">
    <button v-if="!props.toast.timeout" type="button" class="toast-close-button" @click="hide">&times;</button>
    <div v-if="props.toast.title" class="toast-title">{{ props.toast.title }}</div>
    <div class="toast-message">{{ props.toast.message }}</div>
  </div>
</template>
