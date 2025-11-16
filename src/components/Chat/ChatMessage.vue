<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PropType } from 'vue';
import type { ChatMessage } from '../../types';
import { POPUP_TYPE, POPUP_RESULT } from '../../types';
import { useCharacterStore } from '../../stores/character.store';
import { useUiStore } from '../../stores/ui.store';
import { useChatStore } from '../../stores/chat.store';
import { useSettingsStore } from '../../stores/settings.store';
import { usePopupStore, type PopupShowOptions } from '../../stores/popup.store';
import { resolveAvatarUrls } from '../../utils/image';
import { formatTimeStamp } from '../../utils/date';
import { formatMessage } from '../../utils/markdown';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';

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

const editedContent = ref('');

const isEditing = computed(() => chatStore.activeMessageEditIndex === props.index);

watch(isEditing, (editing) => {
  if (editing) {
    editedContent.value = props.message.mes;
  }
});

const avatarUrls = computed(() => {
  const character = characterStore.characters.find((c) => c.name === props.message.name);
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

function startEditing() {
  chatStore.startEditing(props.index);
}

function saveEdit() {
  chatStore.saveMessageEdit(editedContent.value);
}

function cancelEdit() {
  chatStore.cancelEditing();
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
  const isLastMessage = props.index === chatStore.chat.length - 1;
  const canDeleteSwipe = !message.is_user && swipesArray.length > 1 && isLastMessage;

  const performDelete = (isSwipeDelete: boolean) => {
    if (isSwipeDelete) {
      chatStore.deleteSwipe(props.index, message.swipe_id ?? 0);
    } else {
      chatStore.deleteMessage(props.index);
    }
  };

  if (!settingsStore.powerUser.confirm_message_delete) {
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
</script>

<template>
  <div class="message" :class="{ 'is-user': message.is_user, 'is-bot': !message.is_user }" :data-message-index="index">
    <div class="message__avatar-wrapper">
      <div class="message__avatar" @click="handleAvatarClick" style="cursor: pointer">
        <img :src="avatarUrls.thumbnail" :alt="`${displayName} Avatar`" />
      </div>
      <div class="message__id">#{{ index }}</div>
      <div v-if="message.extra?.reasoning_duration" class="message__timer">
        {{ message.extra.reasoning_duration.toFixed(1) }}s
      </div>
      <div v-if="message.extra?.token_count" class="message__token-count">{{ message.extra.token_count }}t</div>
    </div>

    <div class="message__main">
      <div class="message__header">
        <div class="message__name-block">
          <span class="message__name">{{ displayName }}</span>
          <small class="message__timestamp">{{ formattedTimestamp }}</small>
        </div>

        <!-- Buttons for Normal Mode -->
        <div v-if="!isEditing" class="message__buttons">
          <!-- TODO: Implement extra buttons dropdown -->
          <i class="message__button fa-solid fa-ellipsis" title="Message Actions"></i>
          <!-- TODO: Implement bookmark button -->
          <i class="message__button fa-solid fa-flag" title="Bookmark"></i>
          <i @click="startEditing" class="message__button fa-solid fa-pencil" title="Edit"></i>
          <i
            @click="handleDeleteClick"
            class="message__button fa-solid fa-trash-can delete"
            :title="t('chat.buttons.deleteMessage')"
          ></i>
        </div>

        <!-- Buttons for Editing Mode -->
        <div v-else class="message__edit-actions">
          <button
            @click="saveEdit"
            class="menu-button confirm fa-solid fa-check"
            :title="t('chat.buttons.confirmEdit')"
          ></button>
          <button
            @click="copyMessage"
            class="menu-button fa-solid fa-copy"
            :title="t('chat.buttons.copyMessage')"
          ></button>
          <button class="menu-button fa-solid fa-lightbulb" :title="t('chat.buttons.addReasoning')"></button>
          <button @click="moveUp" class="menu-button fa-solid fa-chevron-up" :title="t('chat.buttons.moveUp')"></button>
          <button
            @click="moveDown"
            class="menu-button fa-solid fa-chevron-down"
            :title="t('chat.buttons.moveDown')"
          ></button>
          <button @click="cancelEdit" class="menu-button cancel fa-solid fa-xmark" :title="t('common.cancel')"></button>
        </div>
      </div>

      <div v-if="!isEditing" class="message__content" v-html="formattedContent"></div>
      <div v-else class="message__edit-area">
        <textarea v-model="editedContent" class="text-pole"></textarea>
      </div>
      <!-- TODO: Implement swipes, reasoning block, media, etc. -->
    </div>
  </div>
</template>
