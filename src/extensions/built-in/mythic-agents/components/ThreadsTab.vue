<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Input } from '../../../../components/UI';
import { useMythicState } from '../composables/useMythicState';
import type { MythicExtensionAPI } from '../types';

interface Props {
  api: MythicExtensionAPI;
}

const props = defineProps<Props>();

const newThread = ref('');

const { state: extra, getLatestMythicMessageIndex } = useMythicState(props.api);
const scene = computed(() => extra.value?.scene);
const resolvedThreads = computed(() => props.api.chat.metadata.get()?.extra?.resolved_threads ?? []);

function updateLatestExtra(update: Record<string, unknown>) {
  const mythicIndex = getLatestMythicMessageIndex();
  if (mythicIndex === null) return;
  const history = props.api.chat.getHistory();
  const msg = history[mythicIndex];
  const currentExtra = msg.extra?.['core.mythic-agents'];
  if (!currentExtra) return;
  const newExtra = { ...currentExtra, ...update };
  msg.extra = {
    ...msg.extra,
    'core.mythic-agents': newExtra,
  };
  props.api.chat.updateMessageObject(mythicIndex, {
    extra: msg.extra,
  });
}

function addThread() {
  const trimmed = newThread.value.trim();
  if (!trimmed) return;
  const updatedScene = {
    ...scene.value,
    threads: [...(scene.value?.threads || []), trimmed],
  };
  updateLatestExtra({ scene: updatedScene });
  newThread.value = '';
}

function removeThread(index: number) {
  const updatedThreads = scene.value?.threads.filter((_: string, i: number) => i !== index) || [];
  const updatedScene = {
    ...scene.value,
    threads: updatedThreads,
  };
  updateLatestExtra({ scene: updatedScene });
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
          <Button size="small" variant="danger" title="Remove Thread" @click="removeThread(index)">
            <i class="fas fa-trash"></i>
          </Button>
        </div>
      </li>
    </ul>

    <div v-if="resolvedThreads?.length" class="resolved-threads">
      <h4>Resolved Threads</h4>
      <ul class="thread-list">
        <li v-for="(thread, index) in resolvedThreads" :key="`resolved-${index}`" class="thread-item resolved">
          <span class="thread-text">{{ thread }}</span>
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
