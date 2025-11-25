<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { ref } from 'vue';
import { useResizable } from '../../composables/useResizable';
import type { Settings } from '../../types';

const props = defineProps<{
  side: 'left' | 'right';
  isOpen: boolean;
  storageKey?: keyof Settings['account'];
}>();

const sidebarRef = ref<HTMLElement | null>(null);
const resizerRef = ref<HTMLElement | null>(null);

const cssVariable = props.side === 'left' ? '--sidebar-left-width' : '--sidebar-right-width';

useResizable(sidebarRef, resizerRef, {
  storageKey: props.storageKey,
  initialWidth: 350,
  minWidth: 200,
  side: props.side,
  cssVariable,
});
</script>

<template>
  <aside :id="`sidebar-${side}`" ref="sidebarRef" class="sidebar" :class="[`sidebar--${side}`, { 'is-open': isOpen }]">
    <div ref="resizerRef" class="sidebar-resizer"></div>

    <div :id="`sidebar-${side}-content`" class="sidebar-content">
      <slot></slot>
    </div>
  </aside>
</template>
