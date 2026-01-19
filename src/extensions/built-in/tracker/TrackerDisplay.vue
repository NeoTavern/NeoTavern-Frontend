<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import type { TrackerChatExtra, TrackerData, TrackerMessageExtra, TrackerSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<TrackerSettings, TrackerChatExtra, TrackerMessageExtra>;
  message: ChatMessage;
}>();

// TODO: i18n

const t = props.api.i18n.t;
const collapsedStates = ref<Record<string, boolean>>({});

const trackers = computed<Record<string, TrackerData> | undefined>(() => {
  const msg = props.message as unknown as { extra: TrackerMessageExtra };
  return msg.extra?.['core.tracker']?.trackers;
});

const successfulTrackers = computed(() => {
  if (!trackers.value) return [];
  return Object.values(trackers.value).filter((t) => t.status === 'success' && t.trackerHtml);
});

function isCollapsed(schemaName: string) {
  return collapsedStates.value[schemaName] !== false; // Default to collapsed
}

function toggleCollapse(schemaName: string) {
  collapsedStates.value[schemaName] = !isCollapsed(schemaName);
}
</script>

<template>
  <div v-if="successfulTrackers.length > 0" class="tracker-display-container">
    <div v-for="tracker in successfulTrackers" :key="tracker.schemaName" class="tracker-display">
      <div
        class="tracker-display-header"
        role="button"
        tabindex="0"
        :aria-expanded="!isCollapsed(tracker.schemaName!)"
        :aria-label="t('extensionsBuiltin.tracker.display.title')"
        @click.stop="toggleCollapse(tracker.schemaName!)"
        @keydown.enter.stop.prevent="toggleCollapse(tracker.schemaName!)"
        @keydown.space.stop.prevent="toggleCollapse(tracker.schemaName!)"
      >
        <span>{{ t('extensionsBuiltin.tracker.display.title') }} ({{ tracker.schemaName }})</span>
        <i
          class="fa-solid"
          :class="isCollapsed(tracker.schemaName!) ? 'fa-chevron-down' : 'fa-chevron-up'"
          aria-hidden="true"
        ></i>
      </div>
      <transition name="expand">
        <div
          v-show="!isCollapsed(tracker.schemaName!)"
          class="tracker-display-content"
          v-html="tracker.trackerHtml"
        ></div>
      </transition>
    </div>
  </div>
</template>

<style lang="scss">
.tracker-display-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-sm);
}

.tracker-display {
  border: 1px solid var(--theme-border-color);
  background-color: var(--black-30a);
  border-radius: var(--base-border-radius);
  overflow: hidden;

  .tracker-display-header {
    padding: var(--spacing-xs) var(--spacing-sm);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9em;
    font-weight: bold;
    color: var(--theme-emphasis-color);
    transition: background-color var(--animation-duration-sm);

    &:hover {
      background-color: var(--black-50a);
    }
  }

  .tracker-display-content {
    padding: var(--spacing-sm) var(--spacing-md);
    border-top: 1px solid var(--theme-border-color);
    font-size: 0.95em;

    h4 {
      margin-top: 0;
      margin-bottom: var(--spacing-sm);
      color: var(--theme-underline-color);
    }

    p {
      margin: 0 0 var(--spacing-xs);
    }
  }
}

/* Scoped styles for user-generated content */
.tracker-data-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--spacing-xs) var(--spacing-md);
  align-items: center;

  strong {
    color: var(--theme-emphasis-color);
  }
}

.status-active {
  color: var(--color-accent-green);
}
.status-completed {
  color: var(--color-info-cobalt);
}
.status-failed {
  color: var(--color-error-crimson);
}

.expand-enter-active,
.expand-leave-active {
  transition:
    grid-template-rows 0.3s ease-in-out,
    padding 0.3s ease-in-out,
    opacity 0.3s ease-in-out;
  overflow: hidden;
}
.tracker-display-content {
  display: grid;
  grid-template-rows: 1fr;
  transition:
    grid-template-rows 0.3s ease-in-out,
    padding 0.3s ease-in-out,
    opacity 0.3s ease-in-out;
}
.expand-enter-from,
.expand-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
</style>
