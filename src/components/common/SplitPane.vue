<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAnimationControl } from '../../composables/useAnimationControl';
import { useMobile } from '../../composables/useMobile';
import { useResizable } from '../../composables/useResizable';
import { useStrictI18n } from '../../composables/useStrictI18n';
import type { Settings } from '../../types';

const props = defineProps<{
  storageKey?: keyof Settings['account'];
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  collapsed?: boolean;
  side?: 'left' | 'right';
}>();

const emit = defineEmits<{
  (e: 'update:collapsed', value: boolean): void;
}>();

const { animationsDisabled } = useAnimationControl();
const { isMobile } = useMobile();
const { t } = useStrictI18n();

const paneRef = ref<HTMLElement | null>(null);
const handleRef = ref<HTMLElement | null>(null);

// useResizable does not currently support dynamic disabling/enabling via props easily,
// but it is resilient to resize events if it's not dragged.
// We can conditionally render the logic or just let it exist but hide the handle via CSS.
// However, on desktop we want resizable behavior.
useResizable(paneRef, handleRef, {
  storageKey: props.storageKey,
  initialWidth: props.initialWidth ?? 350,
  minWidth: props.minWidth,
  maxWidth: props.maxWidth,
  side: props.side ?? 'left',
});

function toggleCollapse() {
  emit('update:collapsed', !props.collapsed);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleCollapse();
  }
}

// Icon logic reactive to mobile state
const iconClass = computed(() => {
  if (isMobile.value) {
    return props.collapsed ? 'fa-list' : 'fa-xmark';
  }
  return props.collapsed ? 'fa-angles-right' : 'fa-angles-left';
});

const toggleLabel = computed(() => t(props.collapsed ? 'common.expandSidebar' : 'common.collapseSidebar'));
</script>

<template>
  <!-- 
    We add 'is-mobile' class to help CSS scoping if needed, 
    though mostly handled by @media queries in global styles.
  -->
  <div
    class="split-pane"
    :class="{
      'is-collapsed': collapsed,
      'animations-disabled': animationsDisabled,
      'is-mobile': isMobile,
    }"
  >
    <div ref="paneRef" class="split-pane-panel split-pane-panel--side">
      <slot name="side" />
    </div>

    <div ref="handleRef" class="split-pane-divider">
      <div
        class="split-pane-collapse-toggle"
        :title="toggleLabel"
        role="button"
        :aria-label="toggleLabel"
        :aria-expanded="!collapsed"
        tabindex="0"
        @click.stop="toggleCollapse"
        @keydown="onKeydown"
      >
        <i class="fa-solid" :class="iconClass" aria-hidden="true"></i>
      </div>
    </div>

    <div class="split-pane-main">
      <slot name="main" />
    </div>
  </div>
</template>
