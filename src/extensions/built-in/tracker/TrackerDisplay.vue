<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import type { TrackerData } from './types';

const props = defineProps<{
  api: ExtensionAPI;
  message: ChatMessage;
}>();

// TODO: i18n

const t = props.api.i18n.t;
const isCollapsed = ref(true);

const trackerData = computed<TrackerData | undefined>(() => {
  return props.message.extra?.[props.api.meta.id]?.tracker as TrackerData | undefined;
});

const hasContent = computed(() => {
  return trackerData.value?.status === 'success' && trackerData.value.trackerHtml;
});
</script>

<template>
  <div v-if="hasContent" class="tracker-display">
    <div
      class="tracker-display-header"
      role="button"
      tabindex="0"
      :aria-expanded="!isCollapsed"
      :aria-label="t('extensionsBuiltin.tracker.display.title')"
      @click.stop="isCollapsed = !isCollapsed"
      @keydown.enter.stop.prevent="isCollapsed = !isCollapsed"
      @keydown.space.stop.prevent="isCollapsed = !isCollapsed"
    >
      <span>{{ t('extensionsBuiltin.tracker.display.title') }} ({{ trackerData?.schemaName }})</span>
      <i class="fa-solid" :class="isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'" aria-hidden="true"></i>
    </div>
    <transition name="expand">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-show="!isCollapsed" class="tracker-display-content" v-html="trackerData?.trackerHtml"></div>
    </transition>
  </div>
</template>

<style lang="scss">
.tracker-display {
  border: 1px solid var(--theme-border-color);
  background-color: var(--black-30a);
  border-radius: var(--base-border-radius);
  margin-top: var(--spacing-sm);
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
