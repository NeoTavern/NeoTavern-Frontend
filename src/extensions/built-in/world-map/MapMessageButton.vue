<script setup lang="ts">
import { computed } from 'vue';
import type { ChatMessage } from '../../../types';
import type { WorldMapMessageExtra } from './types';

const props = defineProps<{
  message: ChatMessage;
  title: string;
  clearTitle: string;
}>();

const emit = defineEmits<{
  (e: 'run'): void;
  (e: 'clear'): void;
}>();

const worldMapExtra = computed(() => (props.message.extra as WorldMapMessageExtra)?.['core.world-map']);
const run = computed(() => worldMapExtra.value?.run);
const hasWorldMapData = computed(() => Boolean(worldMapExtra.value));
const status = computed(() => run.value?.status ?? 'idle');

const iconClass = computed(() => {
  if (status.value === 'pending') return 'fa-solid fa-map-location-dot fa-spin';
  if (status.value === 'success') return 'fa-solid fa-map-location-dot world-map-message-button__success';
  if (status.value === 'error') return 'fa-solid fa-map-location-dot world-map-message-button__error';
  return 'fa-solid fa-map-location-dot';
});
</script>

<template>
  <div class="world-map-message-button-group">
    <button
      class="menu-button menu-button--ghost world-map-message-button"
      :title="run?.error || title"
      @click.stop="emit('run')"
    >
      <i :class="iconClass"></i>
    </button>
    <button
      v-if="hasWorldMapData"
      class="menu-button menu-button--ghost world-map-message-button world-map-message-button__clear"
      :title="clearTitle"
      @click.stop="emit('clear')"
    >
      <i class="fa-solid fa-xmark"></i>
    </button>
  </div>
</template>

<style scoped>
.world-map-message-button-group {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.world-map-message-button {
  padding: var(--spacing-xxs) var(--spacing-xs);
  font-size: 0.9em;
  opacity: 0.6;
}

.world-map-message-button:hover {
  opacity: 1;
}

.world-map-message-button__success {
  color: var(--color-accent-green);
}

.world-map-message-button__error {
  color: var(--color-error-crimson);
}

.world-map-message-button__clear {
  padding-inline: var(--spacing-xxs);
}
</style>
