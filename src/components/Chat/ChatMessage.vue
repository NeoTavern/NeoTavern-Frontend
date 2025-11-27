<script setup lang="ts">
import type { PropType } from 'vue';
import { computed, markRaw, onMounted, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { GenerationMode } from '../../constants';
import { useCharacterStore } from '../../stores/character.store';
import { useChatSelectionStore } from '../../stores/chat-selection.store';
import { useChatStore } from '../../stores/chat.store';
import { usePopupStore } from '../../stores/popup.store';
import { usePromptStore } from '../../stores/prompt.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useUiStore } from '../../stores/ui.store';
import type { ChatMessage, PopupShowOptions } from '../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../types';
import { resolveAvatarUrls } from '../../utils/character';
import { formatMessage, formatReasoning } from '../../utils/chat';
import { formatTimeStamp } from '../../utils/commons';
import { SmartAvatar } from '../common';
import { Button, Textarea } from '../UI';
import PromptItemizationPopup from './PromptItemizationPopup.vue';

const props = defineProps({
  message: {
    type: Object as PropType<ChatMessage>,
    required: true,
  },
  index: {
    type: Number,
    required: true,
  },
});

const { t } = useStrictI18n();
const characterStore = useCharacterStore();
const uiStore = useUiStore();
const chatStore = useChatStore();
const chatSelectionStore = useChatSelectionStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const promptStore = usePromptStore();

const editedContent = ref('');
const editedReasoning = ref('');
const isEditingReasoning = ref(false);
const isReasoningCollapsed = ref(false);

const isEditing = computed(() => chatStore.activeMessageEditState?.index === props.index);
const hasReasoning = computed(() => props.message.extra?.reasoning && props.message.extra.reasoning.trim().length > 0);
const hasItemizedPrompt = computed(() => !!promptStore.getItemizedPrompt(props.index));

const isSelectionMode = computed(() => chatSelectionStore.isSelectionMode);
const isSelected = computed(() => chatSelectionStore.selectedMessageIndices.has(props.index));

function handleSelectionClick() {
  if (isSelectionMode.value) {
    chatSelectionStore.toggleMessageSelection(props.index, chatStore.activeChat!.messages.length);
  }
}

onMounted(() => {
  isReasoningCollapsed.value = settingsStore.settings.ui?.chat?.reasoningCollapsed ?? false;
});

watch(isEditing, (editing) => {
  if (editing) {
    editedContent.value = props.message.mes;
    editedReasoning.value = props.message.extra?.reasoning ?? '';
    isEditingReasoning.value = !!props.message.extra?.reasoning;
  } else {
    isEditingReasoning.value = false;
  }
});

const avatarUrls = computed(() => {
  const character = characterStore.characters.find((c) => c.avatar === props.message.original_avatar);
  return resolveAvatarUrls({
    type: 'avatar',
    file: character?.avatar,
    isUser: props.message.is_user || false,
    forceAvatar: props.message.force_avatar,
    activePlayerAvatar: uiStore.activePlayerAvatar,
  });
});

const charNameForAvatar = computed(() => {
  if (props.message.is_user) {
    return uiStore.activePlayerName;
  }
  return props.message.name;
});

function handleAvatarClick() {
  if (isSelectionMode.value) return; // Disable zoom in selection mode
  uiStore.toggleZoomedAvatar({
    src: avatarUrls.value.full,
    charName: charNameForAvatar.value || 'Avatar',
  });
}

const displayName = computed(() => {
  if (props.message.is_user) {
    return uiStore.activePlayerName;
  }
  return props.message.name;
});

const formattedTimestamp = computed(() => {
  return formatTimeStamp(props.message.send_date);
});

const formattedContent = computed(() => {
  return formatMessage(props.message);
});

const formattedReasoning = computed(() => {
  return formatReasoning(props.message);
});

const isLastMessage = computed(
  () => !!chatStore.activeChat?.messages.length && props.index === chatStore.activeChat?.messages.length - 1,
);
const hasSwipes = computed(() => Array.isArray(props.message.swipes) && props.message.swipes.length >= 1);
const canSwipe = computed(() => !props.message.is_user && hasSwipes.value && isLastMessage.value);

function swipe(direction: 'left' | 'right') {
  chatStore.swipeMessage(props.index, direction);
}

function startEditing() {
  chatStore.startEditing(props.index);
}

function saveEdit() {
  const reasoningToSave = isEditingReasoning.value ? editedReasoning.value : undefined;
  chatStore.saveMessageEdit(editedContent.value, reasoningToSave);

  if (props.message.is_system || chatStore.isGenerating || !props.message.is_user) {
    return;
  }

  // Last or second-to-last user message edited
  if (props.index >= chatStore.activeChat!.messages.length - 2) {
    if (isLastMessage.value) {
      chatStore.generateResponse(GenerationMode.NEW);
    } else {
      const nextMessage = chatStore.activeChat!.messages[props.index + 1];
      const isNextMessageBot = !nextMessage.is_user && !nextMessage.is_system;
      if (isNextMessageBot) {
        chatStore.generateResponse(GenerationMode.ADD_SWIPE);
      }
    }
  }
}

function handleEditKeydown(event: KeyboardEvent) {
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    saveEdit();
  }
}

function cancelEdit() {
  chatStore.cancelEditing();
}

function toggleReasoningEdit() {
  isEditingReasoning.value = !isEditingReasoning.value;
  if (!isEditingReasoning.value) {
    editedReasoning.value = '';
  }
}

async function copyMessage() {
  try {
    await navigator.clipboard.writeText(props.message.mes);
  } catch (err) {
    toast.error(t('chat.copy.error'));
    console.error('Failed to copy text: ', err);
  }
}

async function handleDeleteClick() {
  const message = props.message;
  const swipesArray = Array.isArray(message.swipes) ? message.swipes : [];
  const canDeleteSwipe = !message.is_user && swipesArray.length > 1 && isLastMessage.value;

  const performDelete = async (isSwipeDelete: boolean) => {
    try {
      if (isSwipeDelete) {
        await chatStore.deleteSwipe(props.index, message.swipe_id ?? 0);
      } else {
        await chatStore.deleteMessage(props.index);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.message === 'cannot_delete_last_swipe') {
        toast.error(t('chat.delete.lastSwipeError'));
      }
    }
  };

  if (!settingsStore.settings.chat.confirmMessageDelete) {
    await performDelete(canDeleteSwipe);
    return;
  }

  const DELETE_MESSAGE_RESULT = 2;
  let popupConfig: PopupShowOptions = {};

  if (canDeleteSwipe) {
    popupConfig = {
      title: t('chat.delete.confirmTitle'),
      content: t('chat.delete.confirmSwipeMessage'),
      type: POPUP_TYPE.CONFIRM,
      customButtons: [
        { text: t('chat.delete.deleteSwipe'), result: POPUP_RESULT.AFFIRMATIVE, isDefault: true },
        { text: t('chat.delete.deleteMessage'), result: DELETE_MESSAGE_RESULT },
        { text: t('common.cancel'), result: POPUP_RESULT.CANCELLED },
      ],
    };
  } else {
    popupConfig = {
      title: t('chat.delete.confirmTitle'),
      content: t('chat.delete.confirmMessage'),
      type: POPUP_TYPE.CONFIRM,
      okButton: 'common.delete',
      cancelButton: 'common.cancel',
    };
  }

  const { result } = await popupStore.show(popupConfig);

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    await performDelete(canDeleteSwipe); // Delete swipe or message (if not swipe-deletable)
  } else if (result === DELETE_MESSAGE_RESULT) {
    await performDelete(false); // Explicitly delete message
  }
}

function moveUp() {
  chatStore.moveMessage(props.index, 'up');
}

function moveDown() {
  chatStore.moveMessage(props.index, 'down');
}

async function showPromptItemization() {
  const data = promptStore.getItemizedPrompt(props.index);
  if (!data) return;

  await popupStore.show({
    title: t('chat.itemization.title'),
    type: POPUP_TYPE.DISPLAY,
    wide: true,
    large: true,
    component: markRaw(PromptItemizationPopup),
    componentProps: { data },
    okButton: true,
  });
}
</script>

<template>
  <div
    class="message"
    :class="{
      'is-user': message.is_user,
      'is-bot': !message.is_user,
      'is-selected': isSelected,
      'is-selection-mode': isSelectionMode,
    }"
    :data-message-index="index"
    @click="handleSelectionClick"
  >
    <!-- Selection Overlay -->
    <div v-if="isSelectionMode" class="message-selection-overlay">
      <div class="selection-checkbox" :class="{ checked: isSelected }">
        <i v-if="isSelected" class="fa-solid fa-check"></i>
      </div>
    </div>

    <div class="message-avatar-wrapper">
      <div class="message-avatar" style="cursor: pointer" @click.stop="handleAvatarClick">
        <SmartAvatar :urls="[avatarUrls.thumbnail]" :alt="`${displayName} Avatar`" />
      </div>
      <div class="message-id">#{{ index }}</div>
      <div v-if="message.extra?.reasoning_duration" class="message-timer">
        {{ message.extra.reasoning_duration.toFixed(1) }}s
      </div>
      <div v-if="message.extra?.token_count" class="message-token-count">{{ message.extra.token_count }}t</div>
    </div>

    <div class="message-main">
      <div class="message-header">
        <div class="message-name-block">
          <span class="message-name">{{ displayName }}</span>
          <small class="message-timestamp">{{ formattedTimestamp }}</small>
        </div>

        <!-- Buttons for Normal Mode -->
        <div v-show="!isEditing && !isSelectionMode" class="message-buttons">
          <Button
            v-if="hasItemizedPrompt"
            variant="ghost"
            icon="fa-square-poll-horizontal"
            :title="t('chat.buttons.itemization')"
            @click="showPromptItemization"
          />
          <!-- TODO: Implement extra buttons dropdown -->
          <Button variant="ghost" icon="fa-ellipsis" title="Message Actions" />
          <!-- TODO: Implement bookmark button -->
          <Button variant="ghost" icon="fa-flag" title="Bookmark" />
          <Button variant="ghost" icon="fa-pencil" title="Edit" @click="startEditing" />
          <Button
            icon="fa-trash-can"
            variant="danger"
            :title="t('chat.buttons.deleteMessage')"
            @click="handleDeleteClick"
          />
        </div>

        <!-- Buttons for Editing Mode -->
        <div v-show="isEditing" class="message-edit-actions">
          <Button
            icon="fa-check"
            variant="default"
            class="confirm-btn"
            :title="t('chat.buttons.confirmEdit')"
            @click="saveEdit"
          />
          <Button variant="ghost" icon="fa-copy" :title="t('chat.buttons.copyMessage')" @click="copyMessage" />
          <Button
            variant="ghost"
            icon="fa-lightbulb"
            :active="isEditingReasoning"
            :title="t('chat.buttons.addReasoning')"
            @click="toggleReasoningEdit"
          />
          <Button variant="ghost" icon="fa-chevron-up" :title="t('chat.buttons.moveUp')" @click="moveUp" />
          <Button variant="ghost" icon="fa-chevron-down" :title="t('chat.buttons.moveDown')" @click="moveDown" />
          <Button icon="fa-xmark" variant="danger" class="cancel-btn" :title="t('common.cancel')" @click="cancelEdit" />
        </div>
      </div>

      <div v-if="!isEditing && hasReasoning" class="message-reasoning">
        <div class="message-reasoning-header" @click.stop="isReasoningCollapsed = !isReasoningCollapsed">
          <span>{{ t('chat.reasoning.title') }}</span>
          <i class="fa-solid" :class="isReasoningCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'"></i>
        </div>
        <transition name="expand">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-show="!isReasoningCollapsed" class="message-reasoning-content" v-html="formattedReasoning"></div>
        </transition>
      </div>

      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-show="!isEditing" class="message-content" v-html="formattedContent"></div>

      <div v-show="isEditing" class="message-edit-area">
        <transition name="expand">
          <div v-show="isEditingReasoning" class="message-reasoning-edit-area">
            <Textarea v-model="editedReasoning" :label="t('chat.reasoning.title')" :rows="3" :resizable="true" />
          </div>
        </transition>
        <Textarea v-model="editedContent" :rows="5" :resizable="true" @keydown="handleEditKeydown" />
      </div>

      <div v-show="canSwipe && !isSelectionMode" class="message-footer">
        <div class="message-swipe-controls">
          <i
            class="swipe-arrow fa-solid fa-chevron-left"
            :title="t('chat.buttons.swipeLeft')"
            @click="swipe('left')"
          ></i>
          <span class="swipe-counter">{{ (message.swipe_id ?? 0) + 1 }} / {{ message.swipes?.length ?? 0 }}</span>
          <i
            class="swipe-arrow fa-solid fa-chevron-right"
            :title="t('chat.buttons.swipeRight')"
            @click="swipe('right')"
          ></i>
        </div>
      </div>
      <!-- TODO: Implement media, etc. -->
    </div>
  </div>
</template>
