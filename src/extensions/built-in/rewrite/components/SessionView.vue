<script setup lang="ts">
import { autoUpdate, flip, offset, shift, useFloating, type Placement } from '@floating-ui/vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Button, Checkbox, Textarea } from '../../../../components/UI';
import { useStrictI18n } from '../../../../composables/useStrictI18n';
import { useToolStore } from '../../../../stores/tool.store';
import { POPUP_RESULT, POPUP_TYPE, type ExtensionAPI } from '../../../../types';
import type { FieldChange, RewriteField, RewriteLLMResponse, RewriteSessionMessage, RewriteSettings } from '../types';

const props = defineProps<{
  api: ExtensionAPI<RewriteSettings>;
  messages: RewriteSessionMessage[];
  isGenerating: boolean;
  initialFields: RewriteField[];
}>();

const emit = defineEmits<{
  (e: 'send', text: string): void;
  (e: 'delete-from', messageId: string): void;
  (e: 'edit-message', messageId: string, newContent: string): void;
  (e: 'show-diff', changes: FieldChange[]): void;
  (e: 'abort'): void;
  (e: 'regenerate'): void;
}>();

const { t } = useStrictI18n();

const toolStore = useToolStore();

const userInput = ref('');
const chatContainer = ref<HTMLElement | null>(null);

// Tools Menu
const isToolsMenuVisible = ref(false);
const toolsMenuRef = ref<HTMLElement | null>(null);
const toolsMenuTriggerEl = ref<HTMLElement | null>(null);
const toolsMenuPlacement = ref<Placement>('top');
const toolsMenuAnchor = ref({
  getBoundingClientRect: () => new DOMRect(),
});

// Editing State
const editingMessageId = ref<string | null>(null);
const editContent = ref<string>('');

// System Message Collapsing Logic
const isSystemCollapsed = ref(true);

function toggleSystemCollapse() {
  isSystemCollapsed.value = !isSystemCollapsed.value;
}

// Tool Message Collapsing Logic
const collapsedToolMessages = ref<Set<string>>(new Set());

function toggleToolCollapse(msgId: string) {
  if (collapsedToolMessages.value.has(msgId)) {
    collapsedToolMessages.value.delete(msgId);
  } else {
    collapsedToolMessages.value.add(msgId);
  }
  collapsedToolMessages.value = new Set(collapsedToolMessages.value); // Trigger reactivity
}

function isToolCollapsed(msgId: string) {
  return collapsedToolMessages.value.has(msgId);
}

// Tool Calls Collapsing Logic
const collapsedAssistantToolCalls = ref<Set<string>>(new Set());

function toggleAssistantToolCollapse(msgId: string) {
  if (collapsedAssistantToolCalls.value.has(msgId)) {
    collapsedAssistantToolCalls.value.delete(msgId);
  } else {
    collapsedAssistantToolCalls.value.add(msgId);
  }
  collapsedAssistantToolCalls.value = new Set(collapsedAssistantToolCalls.value); // Trigger reactivity
}

function isAssistantToolCollapsed(msgId: string) {
  return collapsedAssistantToolCalls.value.has(msgId);
}

function openToolsMenu(event: Event) {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;

  // If clicking the same element that opened the menu, close it.
  if (isToolsMenuVisible.value && toolsMenuTriggerEl.value === target) {
    isToolsMenuVisible.value = false;
    toolsMenuTriggerEl.value = null;
    return;
  }

  // Determine the anchor element and placement for positioning.
  const anchorElement = target;

  if (anchorElement) {
    // Set placement based on context
    toolsMenuPlacement.value = 'top';

    // Set up the virtual anchor based on the chosen element's position.
    toolsMenuAnchor.value = {
      getBoundingClientRect: () => anchorElement.getBoundingClientRect(),
    };
    toolsMenuTriggerEl.value = target; // Still track original trigger for closing logic.
    isToolsMenuVisible.value = true;
  }
}

function toggleTool(toolName: string) {
  const settings = props.api.settings.get();
  const disabledTools = settings.disabledTools || [];
  const index = disabledTools.indexOf(toolName);
  if (index > -1) {
    disabledTools.splice(index, 1);
  } else {
    disabledTools.push(toolName);
  }
  settings.disabledTools = disabledTools;
  props.api.settings.set(undefined, settings);
  props.api.settings.save();
}

const { floatingStyles: toolsMenuStyles } = useFloating(toolsMenuAnchor, toolsMenuRef, {
  placement: toolsMenuPlacement,
  open: isToolsMenuVisible,
  whileElementsMounted: autoUpdate,
  middleware: [offset(8), flip(), shift({ padding: 10 })],
});

const systemMessageContent = computed(() => {
  const sysMsg = props.messages.find((m) => m.role === 'system');
  return (sysMsg?.content as string) || '';
});

const systemMessagePreview = computed(() => {
  const content = systemMessageContent.value;
  if (!content) return '';
  const lines = content.split('\n');
  return lines.slice(0, 2).join('\n') + (lines.length > 2 || content.length > 100 ? '...' : '');
});

// Scroll and Collapse Logic
watch(
  () => props.messages,
  (newMessages) => {
    nextTick(() => {
      if (chatContainer.value) {
        chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
      }
    });

    const newCollapsedToolMessages = new Set<string>();
    const newCollapsedAssistantToolCalls = new Set<string>();

    newMessages.forEach((msg) => {
      if (msg.role === 'tool') {
        newCollapsedToolMessages.add(msg.id);
      }
      if (msg.role === 'assistant' && hasToolCalls(msg)) {
        newCollapsedAssistantToolCalls.add(msg.id);
      }
    });

    collapsedToolMessages.value = newCollapsedToolMessages;
    collapsedAssistantToolCalls.value = newCollapsedAssistantToolCalls;
  },
  { deep: true, immediate: true },
);

function handleSend() {
  if (userInput.value.trim() && !props.isGenerating) {
    emit('send', userInput.value.trim());
    userInput.value = '';
  }
}

function hasMessageJustification(msg: RewriteSessionMessage): boolean {
  const content = getMessageContent(msg);
  return (
    typeof content === 'object' &&
    content &&
    'justification' in content &&
    typeof (content as RewriteLLMResponse).justification === 'string' &&
    ((content as RewriteLLMResponse).justification || '').trim() !== ''
  );
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

function hasToolCalls(msg: RewriteSessionMessage): boolean {
  const content = getMessageContent(msg);
  return (
    typeof content === 'object' &&
    content &&
    'toolCalls' in content &&
    Array.isArray((content as RewriteLLMResponse).toolCalls) &&
    (content as RewriteLLMResponse).toolCalls!.length > 0
  );
}

function getChangesFromMessage(msg: RewriteSessionMessage, msgIndex: number): FieldChange[] {
  const content = getMessageContent(msg);
  if (typeof content === 'string' || !content) return [];

  // Get the state before this assistant message
  const previousState = new Map<string, string>();
  props.initialFields.forEach((field) => {
    previousState.set(field.id, field.value);
  });

  // Apply changes from all previous assistant messages
  for (let i = 0; i < msgIndex; i++) {
    const prevMsg = props.messages[i];
    if (prevMsg.role !== 'assistant') continue;
    const prevContent = getMessageContent(prevMsg);
    if (typeof prevContent === 'string' || !prevContent) continue;

    if (prevContent.changes) {
      prevContent.changes.forEach((change) => {
        previousState.set(change.fieldId, change.newValue);
      });
    } else if (prevContent.response && props.initialFields.length > 0) {
      const field = props.initialFields[0];
      previousState.set(field.id, prevContent.response);
    }
  }

  const initialFieldsMap = new Map(props.initialFields.map((f) => [f.id, f]));

  if (content.changes) {
    return content.changes.map((c) => {
      const field = initialFieldsMap.get(c.fieldId);
      return {
        ...c,
        label: field?.label || c.fieldId,
        oldValue: previousState.get(c.fieldId) || '',
      };
    });
  }
  if (content.response && props.initialFields.length > 0) {
    const field = props.initialFields[0];
    return [
      {
        fieldId: field.id,
        label: field.label,
        oldValue: previousState.get(field.id) || '',
        newValue: content.response,
      },
    ];
  }
  return [];
}

// Edit Logic
function startEdit(msg: RewriteSessionMessage) {
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

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;

  // Close Tools Menu
  if (isToolsMenuVisible.value) {
    const isInsideToolsMenu = toolsMenuRef.value?.contains(target);
    const isInsideAnchor = toolsMenuTriggerEl.value?.contains(target);

    if (!isInsideToolsMenu && !isInsideAnchor) {
      isToolsMenuVisible.value = false;
      toolsMenuTriggerEl.value = null;
    }
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div class="session-view">
    <div ref="chatContainer" class="chat-container">
      <div v-for="(msg, index) in messages" :key="msg.id" class="message" :class="`role-${msg.role}`">
        <!-- System Message -->
        <div v-if="msg.role === 'system'" class="system-message-inner">
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

        <!-- Tool Message -->
        <div v-if="msg.role === 'tool'" class="tool-message-inner">
          <div class="tool-header" @click="toggleToolCollapse(msg.id)">
            <div class="tool-header-left">
              <i class="fa-solid fa-arrow-turn-down fa-rotate-90"></i>
              <span class="tool-label">{{ t('extensionsBuiltin.rewrite.session.toolResult') }}</span>
            </div>
            <div class="header-right">
              <Button
                icon="fa-trash"
                variant="ghost"
                class="delete-btn-header"
                :title="t('extensionsBuiltin.rewrite.session.deleteFromHere')"
                @click.stop="handleDelete(msg.id)"
              />
              <i
                class="fa-solid collapse-icon"
                :class="isToolCollapsed(msg.id) ? 'fa-chevron-down' : 'fa-chevron-up'"
              ></i>
            </div>
          </div>
          <div v-if="!isToolCollapsed(msg.id)" class="tool-content">
            <pre>{{ msg.content as string }}</pre>
          </div>
        </div>

        <!-- Assistant Message -->
        <div v-if="msg.role === 'assistant'" class="assistant-message-inner">
          <div v-if="hasMessageJustification(msg)" class="assistant-content-wrapper">
            <div class="justification-content">
              {{ (getMessageContent(msg) as RewriteLLMResponse).justification }}
            </div>
            <div class="changes-proposal">
              <div v-for="change in getChangesFromMessage(msg, index)" :key="change.fieldId" class="change-card">
                <div class="change-header">
                  <strong class="change-label">{{ change.label }}</strong>
                  <div class="spacer"></div>
                  <Button
                    icon="fa-code-compare"
                    variant="ghost"
                    :title="t('extensionsBuiltin.rewrite.popup.showDiff')"
                    @click="emit('show-diff', getChangesFromMessage(msg, index))"
                  />
                </div>
                <div class="change-preview">
                  <pre>{{ change.newValue }}</pre>
                </div>
              </div>
            </div>
          </div>

          <div v-if="hasToolCalls(msg)" class="tool-calls-section">
            <div class="tool-calls-header" @click="toggleAssistantToolCollapse(msg.id)">
              <i class="fa-solid fa-wrench"></i>
              <span>{{
                t('extensionsBuiltin.rewrite.session.toolCalls', {
                  count: (getMessageContent(msg) as RewriteLLMResponse).toolCalls!.length,
                })
              }}</span>
              <i
                class="fa-solid collapse-icon"
                :class="isAssistantToolCollapsed(msg.id) ? 'fa-chevron-down' : 'fa-chevron-up'"
              ></i>
            </div>
            <div v-if="!isAssistantToolCollapsed(msg.id)" class="tool-calls-content">
              <div
                v-for="toolCall in (getMessageContent(msg) as RewriteLLMResponse).toolCalls"
                :key="toolCall.name"
                class="tool-call-item"
              >
                <div class="tool-call-name">{{ toolCall.name }}</div>
                <pre class="tool-call-args">{{ toolCall.arguments }}</pre>
              </div>
            </div>
          </div>

          <!-- Message Controls -->
          <div class="assistant-controls">
            <div class="spacer"></div>
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

    <!-- Tools Menu Popover -->
    <div
      v-show="isToolsMenuVisible"
      ref="toolsMenuRef"
      class="tools-menu"
      :style="toolsMenuStyles"
      role="dialog"
      :aria-label="t('chat.tools.title')"
    >
      <div v-if="toolStore.toolList.length === 0" class="empty-state">
        {{ t('chat.tools.noTools') }}
      </div>
      <div v-else class="tools-list">
        <div
          v-for="tool in toolStore.toolList"
          :key="tool.name"
          class="tool-item"
          role="button"
          tabindex="0"
          :aria-pressed="!api.settings.get().disabledTools.includes(tool.name)"
          @click="toggleTool(tool.name)"
          @keydown.enter.prevent="toggleTool(tool.name)"
          @keydown.space.prevent="toggleTool(tool.name)"
        >
          <div class="tool-item-checkbox">
            <Checkbox :model-value="!api.settings.get().disabledTools.includes(tool.name)" label="" />
          </div>
          <div class="tool-item-content">
            <div class="tool-item-header">
              <i v-if="tool.icon" :class="['tool-item-icon', tool.icon]"></i>
              <span class="tool-item-title">{{ tool.displayName || tool.name }}</span>
            </div>
            <div class="tool-item-description">
              {{ tool.description }}
            </div>
          </div>
        </div>
      </div>
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
        <Button
          v-if="toolStore.toolList.length > 0"
          icon="fa-screwdriver-wrench"
          variant="ghost"
          :title="t('chat.tools.title')"
          @click="openToolsMenu"
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

  &.role-user {
    align-self: flex-end;
    background-color: var(--theme-user-message-tint);
    flex-direction: column;
    padding: 10px;
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
    overflow: hidden;
  }

  &.role-tool {
    align-self: flex-start;
    width: calc(100% - 20px);
    margin-left: 20px;
    background-color: var(--black-30a);
    font-size: 0.85em;
    flex-direction: column;
    border: 1px solid var(--theme-border-color);
    border-left: 3px solid var(--theme-emphasis-color);
    overflow: hidden;
  }
}

.collapse-icon {
  opacity: 0.7;
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

.edit-btn-header,
.delete-btn-header {
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
.assistant-content-wrapper {
  padding: 10px;
}

.justification-content {
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 8px;
  font-size: 0.95em;
  opacity: 0.9;
}

.changes-proposal {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.change-card {
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background-color: var(--black-20a);
  overflow: hidden;
}

.change-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background-color: var(--white-10a);
}

.change-label {
  font-weight: 600;
}

.change-preview {
  padding: 10px;
  max-height: 150px;
  overflow-y: auto;
  font-size: 0.9em;
  background-color: var(--black-10a);
}

.assistant-controls {
  display: flex;
  gap: 5px;
  align-items: center;
  border-top: 1px solid var(--theme-border-color);
  padding: 5px;
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

/* Tool Message Styles */
.tool-header {
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

.tool-header-left {
  display: flex;
  align-items: center;
  gap: 8px;

  i {
    opacity: 0.7;
  }
}

.tool-content {
  padding: 10px;
  background-color: var(--black-10a);
  max-height: 200px;
  overflow-y: auto;
}

/* Tool Calls in Assistant Message */
.tool-calls-section {
  border-top: 1px solid var(--theme-border-color);
  margin-top: 10px;
  padding-top: 10px;
  background-color: var(--black-20a);
}

.tool-calls-header {
  padding: 0 10px 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.9em;

  .collapse-icon {
    margin-left: auto;
  }
}

.tool-calls-content {
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-call-item {
  background-color: var(--black-20a);
  border-radius: var(--base-border-radius-xs);
  border: 1px solid var(--theme-border-color);
  overflow: hidden;
}

.tool-call-name {
  padding: 4px 8px;
  font-family: var(--font-family-mono);
  font-size: 0.85em;
  background-color: var(--white-10a);
  font-weight: 600;
}

.tool-call-args {
  padding: 8px;
  font-size: 0.8em;
  max-height: 150px;
  overflow-y: auto;
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
