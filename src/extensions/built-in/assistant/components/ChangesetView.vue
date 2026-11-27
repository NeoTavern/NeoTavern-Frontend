<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button } from '../../../../components/UI';
import type { ExtensionAPI } from '../../../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../../../types/popup';
import TextDiff from '../../_shared/components/TextDiff.vue';
import { Changeset, isCharacterDelete, isGreetingRemoval, type StagedChange } from '../changeset';
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
/** Cards the user opened or closed by hand. Without an entry, pending and conflict cards are open and the rest closed. */
const overrides = ref(new Map<string, boolean>());

interface Group {
  key: string;
  icon: string;
  title: string;
  changes: StagedChange[];
}

function groupOf(change: StagedChange): Omit<Group, 'changes'> {
  const target = change.target;
  switch (target.kind) {
    case 'character-field':
    case 'character':
      return {
        key: `character:${target.avatar}`,
        icon: 'fa-user',
        // A pending create has no character yet; its card label is the name.
        title:
          props.api.character.get(target.avatar)?.name ?? (target.kind === 'character' ? change.label : target.avatar),
      };
    case 'message':
    case 'message-insert':
    case 'message-delete':
      return { key: 'messages', icon: 'fa-comment', title: t('extensionsBuiltin.assistant.panel.groupMessages') };
    case 'entry':
    case 'lorebook':
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
    const group = groupOf(change);
    if (!byKey.has(group.key)) byKey.set(group.key, { ...group, changes: [] });
    byKey.get(group.key)!.changes.push(change);
  }
  return [...byKey.values()];
});

const pendingIds = computed(() =>
  props.changes.filter((change) => change.status === 'pending').map((change) => change.id),
);
/** Accept all leaves character deletes out: they have no undo, so each needs its own Accept. */
const acceptAllCount = computed(
  () => props.changes.filter((change) => change.status === 'pending' && !isCharacterDelete(change)).length,
);
const canUndo = computed(() => new Changeset(props.changes).hasUndo());

const STATUS_LABELS: Record<StagedChange['status'], string> = {
  pending: t('extensionsBuiltin.assistant.panel.status.pending'),
  applied: t('extensionsBuiltin.assistant.panel.status.applied'),
  rejected: t('extensionsBuiltin.assistant.panel.status.rejected'),
  conflict: t('extensionsBuiltin.assistant.panel.status.conflict'),
};

function isOpen(change: StagedChange): boolean {
  return overrides.value.get(change.id) ?? (change.status === 'pending' || change.status === 'conflict');
}

function toggle(change: StagedChange) {
  const next = new Map(overrides.value);
  next.set(change.id, !isOpen(change));
  overrides.value = next;
}

function setAll(open: boolean) {
  overrides.value = new Map(props.changes.map((change) => [change.id, open]));
}

function opLabel(change: StagedChange): string {
  if (isGreetingRemoval(change)) return t('extensionsBuiltin.assistant.panel.opRemoveGreeting');
  const target = change.target;
  switch (target.kind) {
    case 'entry':
      if (target.op === 'update') return '';
      return target.op === 'create'
        ? t('extensionsBuiltin.assistant.panel.opCreate')
        : t('extensionsBuiltin.assistant.panel.opDelete');
    case 'lorebook':
      return target.op === 'create'
        ? t('extensionsBuiltin.assistant.panel.opCreateLorebook')
        : t('extensionsBuiltin.assistant.panel.opDeleteLorebook');
    case 'character':
      return target.op === 'create'
        ? t('extensionsBuiltin.assistant.panel.opCreateCharacter')
        : t('extensionsBuiltin.assistant.panel.opDeleteCharacter');
    case 'message-insert':
      return t('extensionsBuiltin.assistant.panel.opInsertMessage');
    case 'message-delete':
      return t('extensionsBuiltin.assistant.panel.opDeleteMessage');
    default:
      return '';
  }
}

async function acceptOne(change: StagedChange) {
  if (isCharacterDelete(change)) {
    const { result } = await props.api.ui.showPopup({
      title: t('extensionsBuiltin.assistant.panel.deleteCharacterTitle'),
      content: t('extensionsBuiltin.assistant.panel.deleteCharacterContent', { name: change.label }),
      type: POPUP_TYPE.CONFIRM,
      okButton: 'common.delete',
      cancelButton: 'common.cancel',
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) return;
  }
  emit('accept', [change.id]);
}
</script>

<template>
  <div class="changeset">
    <div class="changeset-toolbar">
      <span
        class="changeset-title"
        :title="t('extensionsBuiltin.assistant.panel.toggleAll')"
        @click="setAll(!props.changes.some(isOpen))"
      >
        <i class="fa-solid" :class="props.changes.some(isOpen) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
        {{ t('extensionsBuiltin.assistant.panel.changes') }}
      </span>
      <Button
        v-if="canUndo"
        icon="fa-rotate-left"
        :label="t('extensionsBuiltin.assistant.panel.undoLast')"
        :disabled="busy"
        @click="emit('undo')"
      />
      <Button
        v-if="pendingIds.length > 1"
        variant="danger"
        icon="fa-xmark"
        :label="t('extensionsBuiltin.assistant.panel.rejectAll')"
        :disabled="busy"
        @click="emit('reject', pendingIds)"
      />
      <Button
        v-if="acceptAllCount > 1"
        variant="confirm"
        icon="fa-check-double"
        :label="t('extensionsBuiltin.assistant.panel.acceptAll')"
        :disabled="busy"
        @click="emit('accept')"
      />
    </div>

    <div v-for="group in groups" :key="group.key" class="changeset-group">
      <div class="changeset-group-title">
        <i class="fa-solid" :class="group.icon"></i>
        <span>{{ group.title }}</span>
      </div>

      <div v-for="change in group.changes" :key="change.id" class="change-card" :class="`status-${change.status}`">
        <div class="change-card-header" @click="toggle(change)">
          <i class="fa-solid" :class="isOpen(change) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
          <span class="change-card-label">{{ change.label }}</span>
          <span v-if="opLabel(change)" class="change-card-op">{{ opLabel(change) }}</span>
          <span
            v-if="isCharacterDelete(change) && change.status === 'pending'"
            class="change-card-op no-undo"
            :title="t('extensionsBuiltin.assistant.panel.noUndoHint')"
          >
            <i class="fa-solid fa-triangle-exclamation"></i>
            {{ t('extensionsBuiltin.assistant.panel.noUndo') }}
          </span>
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
            @click="acceptOne(change)"
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
  cursor: pointer;
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
  }
}

.change-card-header {
  cursor: pointer;
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

.no-undo {
  color: var(--color-accent-crimson);
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
