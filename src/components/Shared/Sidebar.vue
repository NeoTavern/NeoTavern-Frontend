<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { ref } from 'vue';
import { useResizable } from '../../composables/useResizable';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useLayoutStore } from '../../stores/layout.store';
import type { Settings } from '../../types';
import Button from '../UI/Button.vue';

const { t } = useStrictI18n();

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
    :aria-hidden="!isOpen"
    :inert="!isOpen"
    role="region"
  >
    <!-- Mobile Header (Visible via CSS media query) -->
    <div class="sidebar-mobile-header">
      <span class="mobile-header-title">
        {{ t(side === 'left' ? 'a11y.sidebar.menu' : 'a11y.sidebar.options') }}
      </span>
      <Button icon="fa-xmark" variant="ghost" :aria-label="t('a11y.sidebar.close')" @click="closeSidebar" />
    </div>

    <div
      ref="resizerRef"
      class="sidebar-resizer"
      role="separator"
      :aria-orientation="'vertical'"
      :aria-label="t(side === 'left' ? 'a11y.sidebar.resizeLeft' : 'a11y.sidebar.resizeRight')"
      tabindex="0"
    ></div>

    <div :id="`sidebar-${side}-content`" class="sidebar-content">
      <slot></slot>
    </div>
  </aside>
</template>
