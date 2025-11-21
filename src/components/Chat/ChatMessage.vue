<script setup lang="ts">
import { computed, ref, watch, onMounted, markRaw } from 'vue';
import type { PropType } from 'vue';
import type { ChatMessage, PopupShowOptions } from '../../types';
import { POPUP_TYPE, POPUP_RESULT } from '../../types';
import { useCharacterStore } from '../../stores/character.store';
import { useUiStore } from '../../stores/ui.store';
import { useChatStore } from '../../stores/chat.store';
import { useSettingsStore } from '../../stores/settings.store';
import { usePopupStore } from '../../stores/popup.store';
import { usePromptStore } from '../../stores/prompt.store';
import { resolveAvatarUrls } from '../../utils/image';
import { formatTimeStamp } from '../../utils/date';
import { formatMessage, formatReasoning } from '../../utils/markdown';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import PromptItemizationPopup from './PromptItemizationPopup.vue';
import { AppIconButton, AppTextarea } from '../UI';
import SmartAvatar from '../Common/SmartAvatar.vue';

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
    toast.success(t('chat.copy.success'));
  } catch (err) {
    toast.error(t('chat.copy.error'));
    console.error('Failed to copy text: ', err);
  }
}

async function handleDeleteClick() {
  const message = props.message;
  const swipesArray = Array.isArray(message.swipes) ? message.swipes : [];
  const canDeleteSwipe = !message.is_user && swipesArray.length > 1 && isLastMessage.value;

  const performDelete = (isSwipeDelete: boolean) => {
    if (isSwipeDelete) {
      chatStore.deleteSwipe(props.index, message.swipe_id ?? 0);
    } else {
      chatStore.deleteMessage(props.index);
    }
  };

  if (!settingsStore.settings.chat.confirmMessageDelete) {
    performDelete(canDeleteSwipe);
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
    performDelete(canDeleteSwipe); // Delete swipe or message (if not swipe-deletable)
  } else if (result === DELETE_MESSAGE_RESULT) {
    performDelete(false); // Explicitly delete message
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
  <div class="message" :class="{ 'is-user': message.is_user, 'is-bot': !message.is_user }" :data-message-index="index">
    <div class="message-avatar-wrapper">
      <div class="message-avatar" style="cursor: pointer" @click="handleAvatarClick">
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
        <div v-show="!isEditing" class="message-buttons">
          <AppIconButton
            v-if="hasItemizedPrompt"
            icon="fa-square-poll-horizontal"
            :title="t('chat.buttons.itemization')"
            @click="showPromptItemization"
          />
          <!-- TODO: Implement extra buttons dropdown -->
          <AppIconButton icon="fa-ellipsis" title="Message Actions" />
          <!-- TODO: Implement bookmark button -->
          <AppIconButton icon="fa-flag" title="Bookmark" />
          <AppIconButton icon="fa-pencil" title="Edit" @click="startEditing" />
          <AppIconButton
            icon="fa-trash-can"
            variant="danger"
            :title="t('chat.buttons.deleteMessage')"
            @click="handleDeleteClick"
          />
        </div>

        <!-- Buttons for Editing Mode -->
        <div v-show="isEditing" class="message-edit-actions">
          <AppIconButton
            icon="fa-check"
            variant="default"
            class="confirm-btn"
            :title="t('chat.buttons.confirmEdit')"
            @click="saveEdit"
          />
          <AppIconButton icon="fa-copy" :title="t('chat.buttons.copyMessage')" @click="copyMessage" />
          <AppIconButton
            icon="fa-lightbulb"
            :active="isEditingReasoning"
            :title="t('chat.buttons.addReasoning')"
            @click="toggleReasoningEdit"
          />
          <AppIconButton icon="fa-chevron-up" :title="t('chat.buttons.moveUp')" @click="moveUp" />
          <AppIconButton icon="fa-chevron-down" :title="t('chat.buttons.moveDown')" @click="moveDown" />
          <AppIconButton
            icon="fa-xmark"
            variant="danger"
            class="cancel-btn"
            :title="t('common.cancel')"
            @click="cancelEdit"
          />
        </div>
      </div>

      <div v-if="!isEditing && hasReasoning" class="message-reasoning">
        <div class="message-reasoning-header" @click="isReasoningCollapsed = !isReasoningCollapsed">
          <span>{{ t('chat.reasoning.title') }}</span>
          <i class="fa-solid" :class="isReasoningCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'"></i>
        </div>
        <transition name="expand">
          <div v-show="!isReasoningCollapsed" class="message-reasoning-content" v-html="formattedReasoning"></div>
        </transition>
      </div>

      <div v-show="!isEditing" class="message-content" v-html="formattedContent"></div>

      <div v-show="isEditing" class="message-edit-area">
        <transition name="expand">
          <div v-show="isEditingReasoning" class="message-reasoning-edit-area">
            <AppTextarea v-model="editedReasoning" :label="t('chat.reasoning.title')" :rows="3" :resizable="true" />
          </div>
        </transition>
        <AppTextarea v-model="editedContent" :rows="5" :resizable="true" />
      </div>

      <div v-if="canSwipe" class="message-footer">
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
