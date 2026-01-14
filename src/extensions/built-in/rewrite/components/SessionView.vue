<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Button, Textarea } from '../../../../components/UI';
import { useStrictI18n } from '../../../../composables/useStrictI18n';
import { POPUP_RESULT, POPUP_TYPE, type ExtensionAPI } from '../../../../types';
import type { RewriteLLMResponse, RewriteSessionMessage, RewriteSettings } from '../types';

const props = defineProps<{
  api: ExtensionAPI<RewriteSettings>;
  messages: RewriteSessionMessage[];
  isGenerating: boolean;
  currentText: string;
}>();

const emit = defineEmits<{
  (e: 'send', text: string): void;
  (e: 'delete-from', messageId: string): void;
  (e: 'edit-message', messageId: string, newContent: string): void;
  (e: 'show-diff', previous: string, current: string): void;
  (e: 'abort'): void;
  (e: 'regenerate'): void;
}>();

const { t } = useStrictI18n();

const userInput = ref('');
const chatContainer = ref<HTMLElement | null>(null);

// Editing State
const editingMessageId = ref<string | null>(null);
const editContent = ref<string>('');

// System Message Collapsing Logic
const isSystemCollapsed = ref(true);

function toggleSystemCollapse() {
  isSystemCollapsed.value = !isSystemCollapsed.value;
}

const systemMessageContent = computed(() => {
  const sysMsg = props.messages.find((m) => m.role === 'system');
  return (sysMsg?.content as string) || '';
});

const systemMessagePreview = computed(() => {
  const content = systemMessageContent.value;
  if (!content) return '';
  const lines = content.split('\n');
  // Return first few lines or truncated text
  return lines.slice(0, 2).join('\n') + (lines.length > 2 || content.length > 100 ? '...' : '');
});

// Scroll Logic
watch(
  () => props.messages,
  () => {
    // Scroll to bottom on new message
    nextTick(() => {
      if (chatContainer.value) {
        chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
      }
    });
  },
  { deep: true, immediate: true },
);

// State Calculation
// Calculates the text state BEFORE each message index.
// textStates[i] corresponds to the text content before message[i] was applied.
const messageStates = computed(() => {
  const states: string[] = [];
  let current = props.currentText;

  for (const msg of props.messages) {
    states.push(current);

    if (msg.role === 'assistant') {
      const response = getResponseText(msg);
      if (response) {
        current = response;
      }
    }
  }
  return states;
});

function handleSend() {
  if (userInput.value.trim() && !props.isGenerating) {
    emit('send', userInput.value.trim());
    userInput.value = '';
  }
}

function getMessageContent(msg: RewriteSessionMessage): RewriteLLMResponse | string {
  if (msg.role !== 'assistant') return msg.content as string;
  try {
    if (typeof msg.content === 'string') {
      return JSON.parse(msg.content);
    }
    return msg.content;
  } catch {
    return msg.content as string;
  }
}

function getJustification(msg: RewriteSessionMessage): string {
  const content = getMessageContent(msg);
  if (typeof content === 'string') return '';
  return content.justification;
}

function getResponseText(msg: RewriteSessionMessage): string | undefined {
  const content = getMessageContent(msg);
  if (typeof content === 'string') return content;
  return content.response;
}

function showDiff(msg: RewriteSessionMessage, index: number) {
  if (msg.role !== 'assistant') return;
  const current = getResponseText(msg);
  if (!current) return;

  // The state before this message is stored in messageStates at the same index
  const previous = messageStates.value[index];

  if (previous === undefined) return;
  emit('show-diff', previous, current);
}

// Edit Logic
function startEdit(msg: RewriteSessionMessage) {
  if (msg.role === 'assistant') return; // Editing assistant messages not supported in this view logic currently
  editingMessageId.value = msg.id;
  editContent.value = msg.content as string;
}

function cancelEdit() {
  editingMessageId.value = null;
  editContent.value = '';
}

function saveEdit(msgId: string) {
  if (editContent.value.trim()) {
    emit('edit-message', msgId, editContent.value);
  }
  cancelEdit();
}

// Delete Logic
async function handleDelete(msgId: string) {
  const { result } = await props.api.ui.showPopup({
    type: POPUP_TYPE.CONFIRM,
    title: t('common.delete'),
    content: t('extensionsBuiltin.rewrite.session.deleteConfirm'),
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    emit('delete-from', msgId);
  }
}
</script>

<template>
  <div class="session-view">
    <div ref="chatContainer" class="chat-container">
      <div v-for="(msg, index) in messages" :key="msg.id" class="message" :class="`role-${msg.role}`">
        <!-- System Message -->
        <div v-if="msg.role === 'system'" class="system-message">
          <div class="system-header" @click="toggleSystemCollapse">
            <span class="system-label">{{ t('extensionsBuiltin.rewrite.session.systemInstruction') }}</span>
            <div class="header-right">
              <Button
                v-if="!editingMessageId"
                icon="fa-pen"
                variant="ghost"
                class="edit-btn-header"
                @click.stop="startEdit(msg)"
              />
              <i class="fa-solid" :class="isSystemCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'"></i>
            </div>
          </div>

          <!-- Edit Mode for System -->
          <div v-if="editingMessageId === msg.id" class="edit-box">
            <Textarea v-model="editContent" :rows="10" />
            <div class="edit-actions">
              <Button variant="ghost" @click="cancelEdit">{{ t('common.cancel') }}</Button>
              <Button variant="confirm" @click="saveEdit(msg.id)">{{ t('common.save') }}</Button>
            </div>
          </div>

          <!-- Display Mode for System -->
          <template v-else>
            <div v-if="isSystemCollapsed" class="system-preview">
              <em>{{ systemMessagePreview }}</em>
            </div>
            <div v-else class="system-content">
              <pre>{{ msg.content as string }}</pre>
            </div>
          </template>
        </div>

        <!-- User Message -->
        <div v-if="msg.role === 'user'" class="user-message">
          <div v-if="editingMessageId === msg.id" class="edit-box user-edit">
            <Textarea v-model="editContent" :rows="3" />
            <div class="edit-actions">
              <Button variant="ghost" @click="cancelEdit">{{ t('common.cancel') }}</Button>
              <Button variant="confirm" @click="saveEdit(msg.id)">{{ t('common.save') }}</Button>
            </div>
          </div>
          <div v-else class="message-content-wrapper">
            <pre>{{ msg.content as string }}</pre>
            <div class="message-hover-actions">
              <Button icon="fa-pen" variant="ghost" class="action-btn" @click="startEdit(msg)" />
              <Button icon="fa-trash" variant="ghost" class="action-btn delete-btn" @click="handleDelete(msg.id)" />
            </div>
          </div>
        </div>

        <!-- Assistant Message -->
        <div v-if="msg.role === 'assistant'" class="assistant-message">
          <!-- Justification / Reasoning Display -->
          <div v-if="getJustification(msg)" class="justification-content">
            {{ getJustification(msg) }}
          </div>

          <!-- Message Controls -->
          <div class="assistant-controls">
            <Button
              v-if="getResponseText(msg)"
              icon="fa-code-compare"
              variant="ghost"
              :title="t('extensionsBuiltin.rewrite.popup.showDiff')"
              class="control-btn"
              @click="showDiff(msg, index)"
            />
            <div class="spacer"></div>
            <!-- Delete for assistant (deletes from here down) -->
            <Button
              icon="fa-trash"
              variant="ghost"
              class="control-btn delete-btn"
              :title="t('extensionsBuiltin.rewrite.session.deleteFromHere')"
              @click="handleDelete(msg.id)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Generating State & Abort -->
    <div v-if="isGenerating" class="generating-status">
      <div class="indicator">
        <i class="fa-solid fa-circle-notch fa-spin"></i>
        <span>{{ t('extensionsBuiltin.rewrite.popup.generating') }}</span>
      </div>
      <Button variant="danger" icon="fa-stop" @click="emit('abort')">
        {{ t('extensionsBuiltin.rewrite.popup.abort') }}
      </Button>
    </div>

    <div class="chat-input-area">
      <div class="chat-input-toolbar">
        <Button
          v-if="!isGenerating && messages.length > 1"
          icon="fa-rotate"
          variant="ghost"
          :title="t('common.regenerate')"
          @click="emit('regenerate')"
        >
          {{ t('common.regenerate') }}
        </Button>
      </div>
      <div class="chat-input">
        <Textarea
          v-model="userInput"
          :placeholder="t('extensionsBuiltin.rewrite.session.typeMessage')"
          :rows="2"
          :disabled="isGenerating"
          @keydown.enter.exact.prevent="handleSend"
        />
        <Button icon="fa-paper-plane" :disabled="isGenerating || !userInput.trim()" @click="handleSend" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '../../../../styles/mixins' as *;

.session-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 400px;
  overflow: hidden;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background-color: var(--black-20a);
}

.chat-container {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.message {
  display: flex;
  position: relative;
  max-width: 90%;
  border-radius: var(--base-border-radius);
  padding: 10px;

  &.role-user {
    align-self: flex-end;
    background-color: var(--theme-user-message-tint);
    flex-direction: column;
  }

  &.role-assistant {
    align-self: flex-start;
    background-color: var(--theme-bot-message-tint);
    flex-direction: column;
    width: 100%;
    max-width: 100%;
  }

  &.role-system {
    align-self: center;
    background-color: var(--black-30a);
    font-size: 0.85em;
    width: 100%;
    max-width: 100%;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }
}

/* System Message Styles */
.system-header {
  padding: 8px 10px;
  background-color: var(--white-10a);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  opacity: 0.8;
  transition: opacity 0.2s;

  &:hover {
    opacity: 1;
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.edit-btn-header {
  padding: 2px 6px;
  height: auto;
  font-size: 0.9em;
}

.system-preview,
.system-content {
  padding: 10px;
}

.system-preview {
  font-style: italic;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Edit Box */
.edit-box {
  padding: 10px;
  background-color: var(--black-30a);
  display: flex;
  flex-direction: column;
  gap: 5px;

  &.user-edit {
    background-color: transparent;
    padding: 0;
  }
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 5px;
}

/* User Message Hover Actions */
.message-content-wrapper {
  position: relative;
  padding-right: 20px;
}

.message-hover-actions {
  position: absolute;
  top: -20px;
  right: 0;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.2s;
  background-color: var(--theme-background-tint);
  border-radius: var(--base-border-radius);
  padding: 2px;
  box-shadow: 0 2px 4px var(--theme-shadow-color);

  @include mobile-override() {
    opacity: 1;
    background-color: var(--black-50a);
    border: 1px solid var(--theme-border-color);
    top: -28px;
  }
}

.message:hover .message-hover-actions {
  opacity: 1;
}

.action-btn {
  padding: 4px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;

  &.delete-btn {
    color: var(--color-warning);
  }
}

pre {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: var(--font-family-main);
}

/* Assistant Styles */
.justification-content {
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 8px;
  font-size: 0.95em;
  opacity: 0.9;
}

.assistant-controls {
  display: flex;
  gap: 5px;
  align-items: center;
  border-top: 1px solid var(--theme-border-color);
  padding-top: 5px;
  margin-top: 5px;
}

.control-btn {
  padding: 4px 8px;
  opacity: 0.7;
  transition: opacity 0.2s;

  &:hover {
    opacity: 1;
  }

  &.delete-btn {
    color: var(--color-warning);
  }
}

.spacer {
  flex: 1;
}

.generating-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background-color: var(--black-50a);
  border-top: 1px solid var(--theme-border-color);

  .indicator {
    display: flex;
    gap: 8px;
    align-items: center;
    opacity: 0.8;
  }
}

/* Input Area */
.chat-input-area {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--theme-border-color);
  background-color: var(--black-50a);
}

.chat-input-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 4px 10px 0;
}

.chat-input {
  display: flex;
  gap: 5px;
  padding: 10px;
}
</style>
