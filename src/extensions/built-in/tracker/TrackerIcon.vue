<script setup lang="ts">
import { computed } from 'vue';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import type { TrackerData } from './types';

const props = defineProps<{
  api: ExtensionAPI;
  message: ChatMessage;
  index: number;
}>();

const emit = defineEmits<{
  (e: 'track'): void;
}>();

// TODO: i18n

const t = props.api.i18n.t;

const trackerData = computed<TrackerData | undefined>(() => {
  return props.message.extra?.[props.api.meta.id]?.tracker as TrackerData | undefined;
});

const status = computed(() => trackerData.value?.status ?? 'idle');

const iconClass = computed(() => {
  switch (status.value) {
    case 'pending':
      return 'fa-solid fa-chart-simple fa-spin';
    case 'success':
      return 'fa-solid fa-chart-simple success';
    case 'error':
      return 'fa-solid fa-chart-simple error';
    default:
      return 'fa-solid fa-chart-simple';
  }
});

const title = computed(() => {
  switch (status.value) {
    case 'pending':
      return t('extensionsBuiltin.tracker.status.pending');
    case 'success':
      return t('extensionsBuiltin.tracker.status.success');
    case 'error':
      return `${t('extensionsBuiltin.tracker.status.error')}: ${trackerData.value?.error ?? 'Unknown'}`;
    default:
      return t('extensionsBuiltin.tracker.status.idle');
  }
});
</script>

<template>
  <button class="menu-button menu-button--ghost tracker-icon" :title="title" @click.stop="emit('track')">
    <i :class="iconClass"></i>
  </button>
</template>

<style scoped>
.tracker-icon {
  padding: var(--spacing-xxs) var(--spacing-xs);
  font-size: 0.9em;
  opacity: 0.6;
}
.tracker-icon:hover {
  opacity: 1;
}
.tracker-icon .success {
  color: var(--color-accent-green);
}
.tracker-icon .error {
  color: var(--color-error-crimson);
}
</style>
