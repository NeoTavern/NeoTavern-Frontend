<script setup lang="ts">
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/vue';
import { onMounted, onUnmounted, ref } from 'vue';
import type { ExtensionAPI } from '../../../../types';
import type { QuickEditTarget } from '../quick-edit';
import type { AssistantSettings } from '../types';
import QuickEditPopover from './QuickEditPopover.vue';

const props = defineProps<{
  api: ExtensionAPI<AssistantSettings>;
  target: QuickEditTarget;
  anchor: HTMLElement;
  initialCommandId?: string;
  onClose: () => void;
}>();

const anchorRef = ref(props.anchor);
const floatingRef = ref<HTMLElement | null>(null);

const { floatingStyles } = useFloating(anchorRef, floatingRef, {
  placement: 'top-end',
  strategy: 'fixed',
  whileElementsMounted: autoUpdate,
  middleware: [
    offset(8),
    flip(),
    shift({ padding: 10 }),
    size({
      padding: 10,
      apply({ availableHeight, elements }) {
        elements.floating.style.maxHeight = `${Math.max(200, availableHeight)}px`;
      },
    }),
  ],
});

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') props.onClose();
}

onMounted(() => document.addEventListener('keydown', handleKeydown));
onUnmounted(() => document.removeEventListener('keydown', handleKeydown));
</script>
<template>
  <div ref="floatingRef" class="floating-quick-edit" :style="floatingStyles">
    <QuickEditPopover :api="api" :target="target" :initial-command-id="initialCommandId" @close="onClose" />
  </div>
</template>
<style scoped lang="scss">
.floating-quick-edit {
  width: min(560px, calc(100vw - 20px));
  padding: var(--spacing-sm);
  overflow-y: auto;
  background-color: var(--theme-background-tint);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  box-shadow: 0 4px 15px var(--theme-shadow-color);
  backdrop-filter: blur(var(--blur-strength, 10px));
  z-index: var(--z-dropdown);
}
</style>
