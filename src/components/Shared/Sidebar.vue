<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { ref } from 'vue';
import { useResizable } from '../../composables/useResizable';
import { useLayoutStore } from '../../stores/layout.store';
import type { Settings } from '../../types';
import Button from '../UI/Button.vue';

const props = defineProps<{
  side: 'left' | 'right';
  isOpen: boolean;
  storageKey?: keyof Settings['account'];
}>();

const layoutStore = useLayoutStore();
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

function closeSidebar() {
  if (props.side === 'left') {
    layoutStore.closeLeftSidebar();
  } else {
    layoutStore.closeRightSidebar();
  }
}
</script>

<template>
  <aside
    :id="`sidebar-${side}`"
    ref="sidebarRef"
    class="sidebar"
    :class="[`sidebar--${side}`, { 'is-open': isOpen }]"
    :style="{ '--sidebar-width': `var(${cssVariable})` }"
  >
    <!-- Mobile Header (Visible via CSS media query) -->
    <div class="sidebar-mobile-header">
      <span class="mobile-header-title">
        {{ side === 'left' ? 'Menu' : 'Options' }}
      </span>
      <Button icon="fa-xmark" variant="ghost" @click="closeSidebar" />
    </div>

    <div ref="resizerRef" class="sidebar-resizer"></div>

    <div :id="`sidebar-${side}-content`" class="sidebar-content">
      <slot></slot>
    </div>
  </aside>
</template>
