<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button } from '../../../../components/UI';
import type { ExtensionAPI } from '../../../../types';
import TextDiff from '../../_shared/components/TextDiff.vue';
import { Changeset, isGreetingRemoval, type ChangeTarget, type StagedChange } from '../changeset';
import type { AssistantSettings } from '../types';

const props = defineProps<{
  api: ExtensionAPI<AssistantSettings>;
  changes: StagedChange[];
  /** A request is running; applying would race the model's staging. */
  busy: boolean;
}>();

const emit = defineEmits<{
  (e: 'accept', ids?: string[]): void;
  (e: 'reject', ids: string[]): void;
  (e: 'undo'): void;
}>();

const t = props.api.i18n.t;
/** Applied and rejected cards start collapsed; these are the ones the user opened. */
const expanded = ref(new Set<string>());

interface Group {
  key: string;
  icon: string;
  title: string;
  changes: StagedChange[];
}

function groupOf(target: ChangeTarget): Omit<Group, 'changes'> {
  switch (target.kind) {
    case 'character-field':
      return {
        key: `character:${target.avatar}`,
        icon: 'fa-user',
        title: props.api.character.get(target.avatar)?.name ?? target.avatar,
      };
    case 'message':
      return { key: 'messages', icon: 'fa-comment', title: t('extensionsBuiltin.assistant.panel.groupMessages') };
    case 'entry':
      return { key: `book:${target.book}`, icon: 'fa-book', title: target.book };
    case 'persona-description': {
      const persona = props.api.persona.getAll().find((candidate) => candidate.avatarId === target.avatarId);
      return { key: `persona:${target.avatarId}`, icon: 'fa-id-card', title: persona?.name ?? target.avatarId };
    }
  }
}

/** Groups in the order their first change was staged. */
const groups = computed<Group[]>(() => {
  const byKey = new Map<string, Group>();
  for (const change of props.changes) {
    const group = groupOf(change.target);
    if (!byKey.has(group.key)) byKey.set(group.key, { ...group, changes: [] });
    byKey.get(group.key)!.changes.push(change);
  }
  return [...byKey.values()];
});

const pendingIds = computed(() =>
  props.changes.filter((change) => change.status === 'pending').map((change) => change.id),
);
const canUndo = computed(() => new Changeset(props.changes).hasUndo());

const STATUS_LABELS: Record<StagedChange['status'], string> = {
  pending: t('extensionsBuiltin.assistant.panel.status.pending'),
  applied: t('extensionsBuiltin.assistant.panel.status.applied'),
  rejected: t('extensionsBuiltin.assistant.panel.status.rejected'),
  conflict: t('extensionsBuiltin.assistant.panel.status.conflict'),
};

function isOpen(change: StagedChange): boolean {
  return change.status === 'pending' || change.status === 'conflict' || expanded.value.has(change.id);
}

function toggle(change: StagedChange) {
  const next = new Set(expanded.value);
  if (next.has(change.id)) next.delete(change.id);
  else next.add(change.id);
  expanded.value = next;
}

function opLabel(change: StagedChange): string {
  if (isGreetingRemoval(change)) return t('extensionsBuiltin.assistant.panel.opRemoveGreeting');
  if (change.target.kind !== 'entry' || change.target.op === 'update') return '';
  return change.target.op === 'create'
    ? t('extensionsBuiltin.assistant.panel.opCreate')
    : t('extensionsBuiltin.assistant.panel.opDelete');
}
</script>

<template>
  <div class="changeset">
    <div class="changeset-toolbar">
      <span class="changeset-title">{{ t('extensionsBuiltin.assistant.panel.changes') }}</span>
      <Button
        v-if="canUndo"
        icon="fa-rotate-left"
        :label="t('extensionsBuiltin.assistant.panel.undoLast')"
        :disabled="busy"
        @click="emit('undo')"
      />
      <template v-if="pendingIds.length > 1">
        <Button
          variant="danger"
          icon="fa-xmark"
          :label="t('extensionsBuiltin.assistant.panel.rejectAll')"
          :disabled="busy"
          @click="emit('reject', pendingIds)"
        />
        <Button
          variant="confirm"
          icon="fa-check-double"
          :label="t('extensionsBuiltin.assistant.panel.acceptAll')"
          :disabled="busy"
          @click="emit('accept')"
        />
      </template>
    </div>

    <div v-for="group in groups" :key="group.key" class="changeset-group">
      <div class="changeset-group-title">
        <i class="fa-solid" :class="group.icon"></i>
        <span>{{ group.title }}</span>
      </div>

      <div v-for="change in group.changes" :key="change.id" class="change-card" :class="`status-${change.status}`">
        <div
          class="change-card-header"
          @click="change.status === 'applied' || change.status === 'rejected' ? toggle(change) : undefined"
        >
          <span class="change-card-label">{{ change.label }}</span>
          <span v-if="opLabel(change)" class="change-card-op">{{ opLabel(change) }}</span>
          <span class="change-card-status">{{ STATUS_LABELS[change.status] }}</span>
        </div>

        <div v-if="change.status === 'conflict'" class="change-card-conflict">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>{{ t('extensionsBuiltin.assistant.panel.conflictHint') }}</span>
        </div>

        <TextDiff
          v-if="isOpen(change)"
          class="change-card-diff"
          :old-value="change.oldValue"
          :new-value="change.newValue"
        >
          <template #old-header>{{ t('extensionsBuiltin.assistant.quickEdit.original') }}</template>
          <template #new-header>{{ t('extensionsBuiltin.assistant.panel.proposed') }}</template>
        </TextDiff>

        <div v-if="change.status === 'pending'" class="change-card-actions">
          <Button
            variant="danger"
            icon="fa-xmark"
            :label="t('extensionsBuiltin.assistant.quickEdit.reject')"
            :disabled="busy"
            @click="emit('reject', [change.id])"
          />
          <Button
            variant="confirm"
            icon="fa-check"
            :label="t('extensionsBuiltin.assistant.quickEdit.accept')"
            :disabled="busy"
            @click="emit('accept', [change.id])"
          />
        </div>
        <div v-else-if="change.status === 'conflict'" class="change-card-actions">
          <Button
            icon="fa-eye-slash"
            :label="t('extensionsBuiltin.assistant.panel.dismiss')"
            :disabled="busy"
            @click="emit('reject', [change.id])"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.changeset {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.changeset-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.changeset-title {
  flex: 1;
  font-weight: bold;
}

.changeset-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.changeset-group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0.8;
  font-size: 0.9em;
}

.change-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--theme-border-color);
  border-radius: 6px;
  background-color: var(--black-30a);

  &.status-conflict {
    border-color: var(--color-accent-crimson);
  }

  &.status-applied,
  &.status-rejected {
    opacity: 0.75;

    .change-card-header {
      cursor: pointer;
    }
  }
}

.change-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.change-card-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-card-op,
.change-card-status {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 999px;
  background-color: var(--white-20a);
  font-size: 0.8em;
}

.change-card-conflict {
  display: flex;
  gap: 6px;
  color: var(--color-accent-crimson);
  font-size: 0.9em;
}

.change-card-diff {
  max-height: 40vh;
}

.change-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
