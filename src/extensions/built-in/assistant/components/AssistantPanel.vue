<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { EmptyState } from '../../../../components/common';
import { Button } from '../../../../components/UI';
import type { ExtensionAPI } from '../../../../types';
import { formatText } from '../../../../utils/chat';
import { POPUP_RESULT, POPUP_TYPE } from '../../../../types/popup';
import { userRequestText, type ConversationMessage, type ConversationToolCall } from '../conversations';
import type { PanelState } from '../panel-state';
import type { AssistantRef } from '../references';
import type { AssistantSettings } from '../types';
import ChangesetView from './ChangesetView.vue';
import MentionInput from './MentionInput.vue';

const props = defineProps<{
  api: ExtensionAPI<AssistantSettings>;
  panel: PanelState;
}>();

const t = props.api.i18n.t;
const state = props.panel.state;
const showList = ref(false);
const messagesElement = ref<HTMLElement>();

const EDIT_TOOLS = new Set([
  'edit_character_field',
  'edit_message',
  'upsert_entry',
  'delete_entry',
  'edit_persona_description',
]);
const READ_TOOLS = new Set([
  'list_characters',
  'get_character',
  'list_lorebooks',
  'get_lorebook',
  'get_messages',
  'get_persona',
]);
/** Argument values longer than this are left out of the one-line call summary. */
const SUMMARY_VALUE_LENGTH = 40;

type DisplayItem =
  | { kind: 'user'; key: string; text: string; refs: AssistantRef[] }
  | { kind: 'assistant'; key: string; text: string }
  | { kind: 'call'; key: string; icon: string; verb: string; name: string; summary: string; error: string };

function callSummary(call: ConversationToolCall): string {
  try {
    const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
    return Object.values(args)
      .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
      .filter((value) => value.length <= SUMMARY_VALUE_LENGTH)
      .join(', ');
  } catch {
    return '';
  }
}

function resultError(content: string | undefined): string {
  if (!content) return '';
  try {
    const result = JSON.parse(content) as unknown;
    return result && typeof result === 'object' && 'error' in result ? String(result.error) : '';
  } catch {
    return '';
  }
}

const items = computed<DisplayItem[]>(() => {
  const messages: ConversationMessage[] = state.conversation.messages;
  const results = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'tool') results.set(message.toolCallId, message.content);
  }

  return messages.flatMap((message, index): DisplayItem[] => {
    if (message.role === 'user') {
      return [{ kind: 'user', key: `${index}`, text: userRequestText(message.content), refs: message.refs }];
    }
    if (message.role === 'tool') return [];
    const calls = message.toolCalls.map(
      (call): DisplayItem => ({
        kind: 'call',
        key: `${index}:${call.id}`,
        icon: EDIT_TOOLS.has(call.name) ? 'fa-pen' : READ_TOOLS.has(call.name) ? 'fa-eye' : 'fa-toolbox',
        verb: EDIT_TOOLS.has(call.name)
          ? t('extensionsBuiltin.assistant.panel.callStaged')
          : READ_TOOLS.has(call.name)
            ? t('extensionsBuiltin.assistant.panel.callRead')
            : t('extensionsBuiltin.assistant.panel.callUsed'),
        name: call.name,
        summary: callSummary(call),
        error: resultError(results.get(call.id)),
      }),
    );
    return message.content ? [{ kind: 'assistant', key: `${index}`, text: message.content }, ...calls] : calls;
  });
});

watch(
  () => state.conversation.messages.length,
  async () => {
    await nextTick();
    messagesElement.value?.scrollTo({ top: messagesElement.value.scrollHeight });
  },
);

function copyMessage(text: string) {
  navigator.clipboard.writeText(text).then(
    () => props.api.ui.showToast(t('extensionsBuiltin.assistant.quickEdit.copied'), 'success'),
    () => props.api.ui.showToast(t('extensionsBuiltin.assistant.quickEdit.copyFailed'), 'error'),
  );
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

async function openConversation(id: string) {
  await props.panel.open(id);
  showList.value = false;
}

function newConversation() {
  props.panel.newConversation();
  showList.value = false;
}

async function deleteConversation(id: string, title: string) {
  const { result } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.assistant.panel.deleteTitle'),
    content: t('extensionsBuiltin.assistant.panel.deleteContent', {
      title: title || t('extensionsBuiltin.assistant.panel.untitled'),
    }),
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.delete',
    cancelButton: 'common.cancel',
  });
  if (result === POPUP_RESULT.AFFIRMATIVE) await props.panel.remove(id);
}

onMounted(() => props.panel.refreshList());
</script>

<template>
  <div class="assistant-panel">
    <div class="assistant-panel-toolbar">
      <Button
        variant="ghost"
        icon="fa-list"
        :active="showList"
        :title="t('extensionsBuiltin.assistant.panel.conversations')"
        :disabled="state.running"
        @click="showList = !showList"
      />
      <span class="assistant-panel-title">
        {{ state.conversation.title || t('extensionsBuiltin.assistant.panel.newConversation') }}
      </span>
      <Button
        variant="ghost"
        icon="fa-plus"
        :title="t('extensionsBuiltin.assistant.panel.newConversation')"
        :disabled="state.running"
        @click="newConversation"
      />
    </div>

    <div v-if="showList" class="assistant-panel-list">
      <EmptyState
        v-if="state.conversations.length === 0"
        icon="fa-comments"
        :description="t('extensionsBuiltin.assistant.panel.noConversations')"
      />
      <div
        v-for="conversation in state.conversations"
        :key="conversation.id"
        class="conversation-item"
        :class="{ active: conversation.id === state.conversation.id }"
        @click="openConversation(conversation.id)"
      >
        <div class="conversation-item-text">
          <span class="conversation-item-title">
            {{ conversation.title || t('extensionsBuiltin.assistant.panel.untitled') }}
          </span>
          <small>{{ formatDate(conversation.updatedAt) }}</small>
        </div>
        <Button
          variant="ghost"
          icon="fa-trash-can"
          :title="t('common.delete')"
          @click.stop="deleteConversation(conversation.id, conversation.title)"
        />
      </div>
    </div>

    <template v-else>
      <div ref="messagesElement" class="assistant-panel-messages">
        <EmptyState
          v-if="items.length === 0"
          icon="fa-wand-magic-sparkles"
          :description="t('extensionsBuiltin.assistant.panel.emptyHint')"
        />
        <template v-for="item in items" :key="item.key">
          <div v-if="item.kind === 'user'" class="assistant-message user">
            <div v-if="item.refs.length > 0" class="assistant-message-refs">
              <span v-for="mention in item.refs" :key="`${mention.kind}:${mention.label}`" class="assistant-ref">
                {{ mention.label }}
              </span>
            </div>
            <div class="assistant-message-text">{{ item.text }}</div>
          </div>
          <div v-else-if="item.kind === 'assistant'" class="assistant-message assistant">
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="markdown" v-html="formatText(item.text, true)"></div>
            <Button
              class="assistant-message-copy"
              variant="ghost"
              icon="fa-copy"
              :title="t('extensionsBuiltin.assistant.panel.copyMessage')"
              @click="copyMessage(item.text)"
            />
          </div>
          <div v-else class="assistant-call" :class="{ failed: item.error }">
            <i class="fa-solid" :class="item.error ? 'fa-triangle-exclamation' : item.icon"></i>
            <span class="assistant-call-text">
              {{ item.verb }} <code>{{ item.name }}</code>
              <span v-if="item.summary" class="assistant-call-args">{{ item.summary }}</span>
              <span v-if="item.error" class="assistant-call-error">{{ item.error }}</span>
            </span>
          </div>
        </template>
        <div v-if="state.running" class="assistant-call">
          <i class="fa-solid fa-circle-notch fa-spin"></i>
          <span>{{ t('extensionsBuiltin.assistant.panel.thinking') }}</span>
        </div>
      </div>

      <div v-if="state.error" class="assistant-panel-error">
        <div class="assistant-panel-error-message">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>{{ state.error.message }}</span>
        </div>
        <details v-if="state.error.rawContent">
          <summary>{{ t('extensionsBuiltin.assistant.panel.rawOutput') }}</summary>
          <pre>{{ state.error.rawContent }}</pre>
        </details>
        <Button
          v-if="state.error.canRetry"
          icon="fa-rotate-right"
          :label="t('extensionsBuiltin.assistant.panel.retry')"
          :disabled="state.running"
          @click="panel.retry()"
        />
      </div>

      <ChangesetView
        v-if="state.conversation.changes.length > 0"
        class="assistant-panel-changes"
        :api="api"
        :changes="state.conversation.changes"
        :busy="state.running"
        @accept="panel.accept($event)"
        @reject="panel.reject($event)"
        @undo="panel.undoLast()"
      />

      <div class="assistant-panel-input">
        <MentionInput
          v-model="state.draft"
          v-model:refs="state.refs"
          :api="api"
          :disabled="state.running"
          :placeholder="t('extensionsBuiltin.assistant.panel.inputPlaceholder')"
          @submit="panel.send()"
        />
        <div class="assistant-panel-input-actions">
          <Button
            v-if="state.running"
            icon="fa-stop"
            :label="t('extensionsBuiltin.assistant.quickEdit.stop')"
            @click="panel.stop()"
          />
          <Button
            v-else
            icon="fa-paper-plane"
            :label="t('extensionsBuiltin.assistant.panel.send')"
            :disabled="!state.draft.trim()"
            @click="panel.send()"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.assistant-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--theme-background-tint);
}

.assistant-panel-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--theme-border-color);
}

.assistant-panel-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: bold;
}

.assistant-panel-list,
.assistant-panel-messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  overflow-y: auto;
  padding: var(--spacing-md);
}

.conversation-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 6px 8px;
  border: 1px solid var(--theme-border-color);
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    background-color: var(--white-20a);
  }

  &.active {
    border-color: var(--theme-emphasis-color);
  }
}

.conversation-item-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;

  small {
    opacity: 0.6;
  }
}

.conversation-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;

  &.user {
    align-self: flex-end;
    max-width: 90%;
    background-color: var(--white-20a);
  }

  &.assistant {
    position: relative;
    background-color: var(--black-30a);

    &:hover .assistant-message-copy {
      opacity: 1;
    }
  }
}

.assistant-message-copy {
  align-self: flex-end;
  opacity: 0.4;
}

.markdown {
  word-break: break-word;

  :deep(> :first-child) {
    margin-top: 0;
  }

  :deep(> :last-child) {
    margin-bottom: 0;
  }

  :deep(p) {
    margin: 0 0 0.5em;

    &:last-child {
      margin-bottom: 0;
    }
  }

  /* The dialogue renderer keeps the literal quote characters inside <q>; drop the browser's own marks. */
  :deep(q::before),
  :deep(q::after) {
    content: '';
  }

  :deep(pre) {
    overflow-x: auto;
    padding: 6px 8px;
    border-radius: 6px;
    background-color: var(--black-30a);
  }

  :deep(ul),
  :deep(ol) {
    padding-left: 1.4em;
  }
}

.assistant-message-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.assistant-message-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.assistant-ref {
  padding: 0 6px;
  border-radius: 999px;
  background-color: var(--black-30a);
  font-size: 0.8em;
}

.assistant-call {
  display: flex;
  align-items: baseline;
  gap: 6px;
  opacity: 0.7;
  font-size: 0.85em;

  &.failed {
    color: var(--color-accent-crimson);
    opacity: 1;
  }
}

.assistant-call-text {
  min-width: 0;
  word-break: break-word;
}

.assistant-call-args {
  margin-left: 4px;
  opacity: 0.8;
}

.assistant-call-error {
  display: block;
}

.assistant-panel-error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: var(--spacing-sm) var(--spacing-md);
  border-top: 1px solid var(--theme-border-color);
  color: var(--color-accent-crimson);
  font-size: 0.9em;

  details {
    max-width: 100%;
    color: var(--theme-text-color);
  }

  pre {
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.assistant-panel-error-message {
  display: flex;
  gap: 6px;
  word-break: break-word;
}

.assistant-panel-changes {
  max-height: 45%;
  overflow-y: auto;
  padding: var(--spacing-sm) var(--spacing-md);
  border-top: 1px solid var(--theme-border-color);
}

.assistant-panel-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--spacing-sm) var(--spacing-md);
  border-top: 1px solid var(--theme-border-color);
}

.assistant-panel-input-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
