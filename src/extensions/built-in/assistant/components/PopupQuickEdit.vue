<script setup lang="ts">
import type { ExtensionAPI } from '../../../../types';
import type { QuickEditTarget } from '../quick-edit';
import type { AssistantSettings } from '../types';
import QuickEditPopover from './QuickEditPopover.vue';

defineProps<{
  api: ExtensionAPI<AssistantSettings>;
  target: QuickEditTarget;
  /** Injected by the popup store. */
  closePopup?: () => void;
}>();
</script>
<template>
  <QuickEditPopover :api="api" :target="target" @close="closePopup?.()" />
</template>
