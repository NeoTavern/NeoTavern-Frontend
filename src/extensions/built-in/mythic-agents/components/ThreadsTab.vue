<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Input } from '../../../../components/UI';
import type { MythicChatExtraData, MythicExtensionAPI } from '../types';

interface Props {
  api: MythicExtensionAPI;
}

const props = defineProps<Props>();

const newThread = ref('');

const chatInfo = computed(() => props.api.chat.getChatInfo());
const extra = computed(
  () => chatInfo.value?.chat_metadata.extra?.['core.mythic-agents'] as MythicChatExtraData | undefined,
);
const scene = computed(() => extra.value?.scene);

function addThread() {
  const trimmed = newThread.value.trim();
  if (!trimmed) return;
  const updatedScene = {
    ...scene.value,
    threads: [...(scene.value?.threads || []), trimmed],
  };
  props.api.chat.metadata.update({
    extra: {
      'core.mythic-agents': {
        scene: updatedScene,
      },
    },
  });
  newThread.value = '';
}

function resolveThread(index: number) {
  const thread = scene.value?.threads[index];
  if (!thread) return;
  const updatedThreads = scene.value?.threads.filter((_, i) => i !== index) || [];
  const updatedScene = {
    ...scene.value,
    threads: updatedThreads,
  };
  const currentResolved = extra.value?.resolved_threads || [];
  props.api.chat.metadata.update({
    extra: {
      'core.mythic-agents': {
        scene: updatedScene,
        resolved_threads: [...currentResolved, thread],
      },
    },
  });
}

function removeThread(index: number) {
  const updatedThreads = scene.value?.threads.filter((_, i) => i !== index) || [];
  const updatedScene = {
    ...scene.value,
    threads: updatedThreads,
  };
  props.api.chat.metadata.update({
    extra: {
      'core.mythic-agents': {
        scene: updatedScene,
      },
    },
  });
}

function revertThread(index: number) {
  const thread = extra.value?.resolved_threads?.[index];
  if (!thread) return;
  const updatedResolved = extra.value?.resolved_threads?.filter((_, i) => i !== index) || [];
  const updatedThreads = [...(scene.value?.threads || []), thread];
  const updatedScene = {
    ...scene.value,
    threads: updatedThreads,
  };
  props.api.chat.metadata.update({
    extra: {
      'core.mythic-agents': {
        scene: updatedScene,
        resolved_threads: updatedResolved,
      },
    },
  });
}
</script>

<template>
  <div class="threads">
    <div class="add-thread-form">
      <Input
        v-model.trim="newThread"
        class="thread-input"
        placeholder="Add a new plot thread..."
        @keyup.enter="addThread"
      />
      <Button :disabled="!newThread.trim()" @click="addThread"> <i class="fas fa-plus"></i> Add </Button>
    </div>

    <div v-if="!scene?.threads.length" class="empty-state">No open threads. Add one to track plot points.</div>

    <ul class="thread-list">
      <li v-for="(thread, index) in scene?.threads || []" :key="index" class="thread-item">
        <span class="thread-text">{{ thread }}</span>
        <div class="thread-actions">
          <Button size="small" variant="ghost" title="Resolve Thread" @click="resolveThread(index)">
            <i class="fas fa-check"></i>
          </Button>
          <Button size="small" variant="danger" title="Remove Thread" @click="removeThread(index)">
            <i class="fas fa-trash"></i>
          </Button>
        </div>
      </li>
    </ul>

    <div v-if="extra?.resolved_threads?.length" class="resolved-threads">
      <h4>Resolved Threads</h4>
      <ul class="thread-list">
        <li v-for="(thread, index) in extra.resolved_threads" :key="`resolved-${index}`" class="thread-item resolved">
          <span class="thread-text">{{ thread }}</span>
          <div class="thread-actions">
            <Button size="small" variant="ghost" title="Revert Thread" @click="revertThread(index)">
              <i class="fas fa-undo"></i>
            </Button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.threads {
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.add-thread-form {
  display: flex;
  gap: var(--spacing-sm);
}

.thread-input {
  flex: 1;
}

.thread-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.thread-item {
  background-color: var(--black-30a);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-sm) var(--spacing-md);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-md);
  transition: background-color var(--animation-duration-sm);

  &:hover {
    background-color: var(--black-50a);
  }
}

.thread-text {
  flex: 1;
  word-break: break-word;
  color: var(--theme-text-color);
}

.thread-actions {
  display: flex;
  gap: var(--spacing-xs);
  flex-shrink: 0;
}

.resolved-threads {
  margin-top: var(--spacing-lg);
}

.resolved-threads h4 {
  margin: 0 0 var(--spacing-sm) 0;
  color: var(--theme-emphasis-color);
  font-size: var(--font-size-md);
}

.thread-item.resolved {
  opacity: 0.7;
  background-color: var(--black-20a);
}
</style>
