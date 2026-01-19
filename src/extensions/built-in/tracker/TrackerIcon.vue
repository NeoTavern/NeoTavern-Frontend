<script setup lang="ts">
import { computed } from 'vue';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import type { TrackerChatExtra, TrackerData, TrackerMessageExtra, TrackerSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<TrackerSettings, TrackerChatExtra, TrackerMessageExtra>;
  message: ChatMessage;
  index: number;
}>();

const emit = defineEmits<{
  (e: 'track'): void;
}>();

// TODO: i18n

const t = props.api.i18n.t;

const trackers = computed<Record<string, TrackerData> | undefined>(() => {
  const msg = props.message as unknown as { extra: TrackerMessageExtra };
  return msg.extra?.['core.tracker']?.trackers;
});

const status = computed(() => {
  if (!trackers.value) return 'idle';
  const allTrackers = Object.values(trackers.value);
  if (allTrackers.length === 0) return 'idle';

  if (allTrackers.some((t) => t.status === 'pending')) return 'pending';
  if (allTrackers.some((t) => t.status === 'error')) return 'error';
  if (allTrackers.every((t) => t.status === 'success')) return 'success';

  return 'idle';
});

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
  if (!trackers.value) return t('extensionsBuiltin.tracker.status.idle');

  const allTrackers = Object.values(trackers.value);
  const getNames = (s: TrackerData['status']) =>
    allTrackers
      .filter((t) => t.status === s)
      .map((t) => t.schemaName)
      .join(', ');

  switch (status.value) {
    case 'pending':
      return `${t('extensionsBuiltin.tracker.status.pending')}: ${getNames('pending')}`;
    case 'success':
      return t('extensionsBuiltin.tracker.status.success');
    case 'error':
      const errorTracker = allTrackers.find((t) => t.status === 'error');
      return `${t('extensionsBuiltin.tracker.status.error')} in ${getNames('error')}: ${
        errorTracker?.error ?? 'Unknown'
      }`;
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
