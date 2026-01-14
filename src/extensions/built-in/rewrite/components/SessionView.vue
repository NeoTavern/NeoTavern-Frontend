<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Button, Textarea } from '../../../../components/UI';
import { useStrictI18n } from '../../../../composables/useStrictI18n';
import type { RewriteLLMResponse, RewriteSessionMessage } from '../types';

const props = defineProps<{
  messages: RewriteSessionMessage[];
  isGenerating: boolean;
  currentText: string;
}>();

const emit = defineEmits<{
  (e: 'send', text: string): void;
  (e: 'delete-from', messageId: string): void;
  (e: 'apply-text', text: string): void;
  (e: 'show-diff', previous: string, current: string): void;
  (e: 'abort'): void;
}>();

const { t } = useStrictI18n();

const userInput = ref('');
const chatContainer = ref<HTMLElement | null>(null);

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

function getResponseText(msg: RewriteSessionMessage): string {
  const content = getMessageContent(msg);
  if (typeof content === 'string') return content;
  return content.response;
}

function showDiff(msg: RewriteSessionMessage) {
  if (msg.role !== 'assistant' || !msg.previousTextState) return;
  const current = getResponseText(msg);
  emit('show-diff', msg.previousTextState, current);
}
</script>

<template>
  <div class="session-view">
    <div ref="chatContainer" class="chat-container">
      <div v-for="msg in messages" :key="msg.id" class="message" :class="`role-${msg.role}`">
        <!-- Collapsible System Message -->
        <div v-if="msg.role === 'system'" class="system-message">
          <div class="system-header" @click="toggleSystemCollapse">
            <span class="system-label">{{ t('extensionsBuiltin.rewrite.session.systemInstruction') }}</span>
            <i class="fa-solid" :class="isSystemCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'"></i>
          </div>
          <div v-if="isSystemCollapsed" class="system-preview">
            <em>{{ systemMessagePreview }}</em>
          </div>
          <div v-else class="system-content">
            <pre>{{ msg.content as string }}</pre>
          </div>
        </div>

        <div v-if="msg.role === 'user'" class="user-message">
          <pre>{{ msg.content as string }}</pre>
        </div>

        <div v-if="msg.role === 'assistant'" class="assistant-message">
          <!-- Justification / Reasoning Display -->
          <div v-if="getJustification(msg)" class="justification-content">
            {{ getJustification(msg) }}
          </div>
          <!-- Fallback if no justification (legacy or plain text response) -->
          <div v-else class="raw-response">
            <pre>{{ getResponseText(msg) }}</pre>
          </div>

          <!-- Message Controls -->
          <div class="assistant-controls">
            <Button
              v-if="msg.previousTextState"
              icon="fa-code-compare"
              variant="ghost"
              :title="t('extensionsBuiltin.rewrite.popup.showDiff')"
              class="control-btn"
              @click="showDiff(msg)"
            />
            <Button
              icon="fa-check"
              variant="ghost"
              :title="t('extensionsBuiltin.rewrite.popup.apply')"
              class="control-btn apply-btn"
              @click="emit('apply-text', getResponseText(msg))"
            />
          </div>
        </div>

        <div v-if="msg.role !== 'system'" class="message-actions">
          <Button
            icon="fa-trash"
            variant="ghost"
            class="delete-btn"
            :title="t('extensionsBuiltin.rewrite.session.deleteFromHere')"
            @click="emit('delete-from', msg.id)"
          />
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

  &:hover .message-actions {
    opacity: 1;
  }
}

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

.message-actions {
  position: absolute;
  top: 5px;
  right: -35px;
  opacity: 0;
  transition: opacity 0.2s;
  .delete-btn {
    color: var(--color-warning);
  }
}

pre {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: var(--font-family-main);
}

.justification-content {
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 8px;
  font-size: 0.95em;
}

.assistant-controls {
  display: flex;
  gap: 5px;
  justify-content: flex-end;
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
}

.apply-btn {
  color: var(--color-accent-green);
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

.chat-input {
  display: flex;
  gap: 5px;
  padding: 10px;
  border-top: 1px solid var(--theme-border-color);
  background-color: var(--black-50a);
}
</style>
