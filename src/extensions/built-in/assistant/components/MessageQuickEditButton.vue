<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '../../../../components/UI';
import type { ChatMessage, ExtensionAPI } from '../../../../types';
import { createMessageTarget, openQuickEditPopover } from '../quick-edit-ui';
import type { AssistantSettings } from '../types';

const props = defineProps<{
  message: ChatMessage;
  index: number;
  api: ExtensionAPI<AssistantSettings>;
}>();

const anchor = ref<HTMLElement | null>(null);

function open() {
  const target = createMessageTarget(props.api, props.index);
  if (target && anchor.value) openQuickEditPopover(props.api, anchor.value, target);
}
</script>
<template>
  <span ref="anchor" class="assistant-message-button">
    <Button
      variant="ghost"
      icon="fa-wand-magic-sparkles"
      :title="api.i18n.t('extensionsBuiltin.assistant.quickEdit.open')"
      @click.stop="open"
    />
  </span>
</template>
<style scoped>
.assistant-message-button {
  display: inline-flex;
}
</style>
