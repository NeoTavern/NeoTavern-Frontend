<script setup lang="ts">
import type { PropType } from 'vue';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
// eslint-disable-next-line vue/no-dupe-keys
import { toast, type Toast } from '../../composables/useToast';

const props = defineProps({
  toast: {
    type: Object as PropType<Toast>,
    required: true,
  },
});

const isVisible = ref(false);
let timerId: ReturnType<typeof setTimeout> | undefined;

function startTimer() {
  if (timerId) {
    clearTimeout(timerId);
    timerId = undefined;
  }

  if (props.toast.timeout && props.toast.timeout > 0) {
    timerId = setTimeout(() => {
      hide();
    }, props.toast.timeout);
  }
}

onMounted(() => {
  // Animate in
  requestAnimationFrame(() => {
    isVisible.value = true;
  });

  startTimer();
});

onBeforeUnmount(() => {
  if (timerId) clearTimeout(timerId);
});

watch(
  () => props.toast.count,
  () => {
    startTimer();
  },
);

function hide() {
  isVisible.value = false;
  const transitionDuration = 250;

  if (timerId) {
    clearTimeout(timerId);
    timerId = undefined;
  }

  setTimeout(() => {
    toast.remove(props.toast.id);
  }, transitionDuration + 10); // Add a small buffer
}
</script>

<template>
  <div class="toast" :class="[`toast-${props.toast.type}`, { show: isVisible }]">
    <button v-if="!props.toast.timeout" type="button" class="toast-close-button" @click="hide">&times;</button>
    <div v-if="props.toast.title" class="toast-title">
      {{ props.toast.title }}
    </div>
    <div class="toast-message">
      {{ props.toast.message }}
      <span v-if="props.toast.count > 1" :key="props.toast.count" class="toast-counter">
        x{{ props.toast.count }}
      </span>
    </div>
  </div>
</template>
