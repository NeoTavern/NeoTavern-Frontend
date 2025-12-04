<script setup lang="ts">
import { ref } from 'vue';
import { useAnimationControl } from '../../composables/useAnimationControl';
import { useResizable } from '../../composables/useResizable';
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

const paneRef = ref<HTMLElement | null>(null);
const handleRef = ref<HTMLElement | null>(null);

// If side is right, we might need different logic in useResizable or CSS,
// but looking at existing usage, most are left-side browsers.
// CharacterPanel, ExtensionsDrawer, WorldInfoDrawer are all left-side browsers.
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
</script>

<template>
  <div class="split-pane" :class="{ 'is-collapsed': collapsed, 'animations-disabled': animationsDisabled }">
    <div ref="paneRef" class="split-pane-panel split-pane-panel--side">
      <slot name="side" />
    </div>

    <div ref="handleRef" class="split-pane-divider">
      <div class="split-pane-collapse-toggle" :title="collapsed ? 'Expand' : 'Collapse'" @click.stop="toggleCollapse">
        <i class="fa-solid" :class="collapsed ? 'fa-angles-right' : 'fa-angles-left'"></i>
      </div>
    </div>

    <div class="split-pane-main">
      <!-- Core main pane for split layouts; standalone main-only views no longer wrap content in extra split-pane-main -->
      <slot name="main" />
    </div>
  </div>
</template>
