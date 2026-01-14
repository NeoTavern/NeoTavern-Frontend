<script setup lang="ts">
import { Button } from '../../../../components/UI';
import { useStrictI18n } from '../../../../composables/useStrictI18n';
import type { RewriteSession } from '../types';

const emit = defineEmits<{
  (e: 'new-session'): void;
  (e: 'load-session', id: string): void;
  (e: 'delete-session', id: string): void;
}>();

defineProps<{
  sessions: RewriteSession[];
  currentSessionId?: string;
}>();

const { t } = useStrictI18n();
</script>

<template>
  <div class="session-manager">
    <div class="header">
      <h4>{{ t('extensionsBuiltin.rewrite.session.sessions') }}</h4>
      <Button icon="fa-plus" @click="emit('new-session')">{{ t('common.new') }}</Button>
    </div>
    <div class="session-list">
      <div v-if="sessions.length === 0" class="empty-state">
        {{ t('extensionsBuiltin.rewrite.session.noSessions') }}
      </div>
      <div
        v-for="session in sessions"
        :key="session.id"
        class="session-item"
        :class="{ active: currentSessionId === session.id }"
        @click="emit('load-session', session.id)"
      >
        <span class="session-name">
          {{
            t('extensionsBuiltin.rewrite.session.sessionItem', { date: new Date(session.updatedAt).toLocaleString() })
          }}
        </span>
        <Button icon="fa-trash" variant="ghost" class="delete-btn" @click.stop="emit('delete-session', session.id)" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.session-manager {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background-color: var(--black-20a);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;

  h4 {
    margin: 0;
  }
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 200px;
  overflow-y: auto;
}

.session-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background-color: var(--black-30a);
  border-radius: var(--base-border-radius);
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--black-50a);
  }

  &.active {
    background-color: var(--theme-emphasis-color);
    color: var(--black-100);

    .delete-btn {
      color: inherit;
      opacity: 0.7;
    }
  }
}

.session-name {
  flex: 1;
  font-size: 0.9em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.delete-btn {
  color: var(--color-warning);
  padding: 4px;
}

.empty-state {
  font-size: 0.9em;
  font-style: italic;
  opacity: 0.7;
  padding: 10px;
  text-align: center;
}
</style>
