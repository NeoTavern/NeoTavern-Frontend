<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '../../../../components/UI';
import type { ChatMessage, ExtensionAPI } from '../../../../types';
import { commandIcon, runCommandAndApply } from '../quick-edit';
import { createMessageTarget, openQuickEditPopover } from '../quick-edit-ui';
import type { AssistantCommand, AssistantSettings } from '../types';

const props = defineProps<{
  message: ChatMessage;
  index: number;
  api: ExtensionAPI<AssistantSettings>;
  command: AssistantCommand;
}>();

const anchor = ref<HTMLElement | null>(null);
const busy = ref(false);

async function click() {
  if (busy.value) return;
  const target = createMessageTarget(props.api, props.index);
  if (!target) return;
  if (!props.command.autoAccept) {
    if (anchor.value) openQuickEditPopover(props.api, anchor.value, target, props.command.id);
    return;
  }
  busy.value = true;
  try {
    await runCommandAndApply(props.api, target, props.command);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <span ref="anchor" class="assistant-pinned-button">
    <Button
      variant="ghost"
      :icon="commandIcon(command)"
      :loading="busy"
      :label="command.name"
      :title="busy ? api.i18n.t('extensionsBuiltin.assistant.pinned.running', { name: command.name }) : command.prompt"
      @click.stop="click"
    />
  </span>
</template>
<style scoped>
.assistant-pinned-button {
  display: inline-flex;
}
</style>
