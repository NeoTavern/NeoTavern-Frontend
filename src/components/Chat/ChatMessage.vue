<script setup lang="ts">
import type { PropType } from 'vue';
import { computed, markRaw, nextTick, onMounted, ref, watch } from 'vue';
import { useAnimationControl } from '../../composables/useAnimationControl';
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
import type { ChatMessage, PopupShowOptions, ZoomedAvatarTool } from '../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../types';
import type { TextareaToolDefinition } from '../../types/ExtensionAPI';
import { resolveAvatarUrls } from '../../utils/character';
import { formatMessage, formatReasoning } from '../../utils/chat';
import { formatTimeStamp } from '../../utils/commons';
import { isDataURL } from '../../utils/media';
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

// TODO: i18n

const { t } = useStrictI18n();
const characterStore = useCharacterStore();
const uiStore = useUiStore();
const chatStore = useChatStore();
const chatSelectionStore = useChatSelectionStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const promptStore = usePromptStore();
const { animationsDisabled } = useAnimationControl();

const editedContent = ref('');
const editedReasoning = ref('');
const isEditingReasoning = ref(false);
const isReasoningCollapsed = ref(false);
const editTextarea = ref<InstanceType<typeof Textarea>>();

const isEditing = computed(() => chatStore.activeMessageEditState?.index === props.index);
const hasReasoning = computed(() => props.message.extra?.reasoning && props.message.extra.reasoning.trim().length > 0);
const hasItemizedPrompt = computed(() => !!promptStore.getItemizedPrompt(props.index, props.message.swipe_id ?? 0));
const isSmallSys = computed(() => !!props.message.extra?.isSmallSys);

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

watch(isEditing, async (editing) => {
  if (editing) {
    editedContent.value = props.message.mes;
    editedReasoning.value = props.message.extra?.reasoning ?? '';
    isEditingReasoning.value = !!props.message.extra?.reasoning;
    await nextTick();
    editTextarea.value?.focus();
  } else {
    isEditingReasoning.value = false;
  }
});

const avatarUrls = computed(() => {
  let character = characterStore.characters.find((c) => c.avatar === props.message.original_avatar);
  if (!character) {
    character = characterStore.characters.find((c) => c.name === props.message.name);
  }
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

const formattedTimestamp = computed(() => {
  return formatTimeStamp(props.message.send_date);
});

const forbidExternalMedia = computed(() => settingsStore.settings.ui.chat.forbidExternalMedia);

const formattedContent = computed(() => {
  return formatMessage(props.message, forbidExternalMedia.value);
});

const formattedReasoning = computed(() => {
  return formatReasoning(props.message, forbidExternalMedia.value);
});

const attachmentMediaItems = computed(() => {
  if (!props.message.extra?.media) return [];
  return (
    props.message.extra.media
      // Filter for non-inline media to show in the grid
      .filter((item) => item.source !== 'inline')
      .map((item, idx) => {
        const key = `${props.index}-${props.message.swipe_id ?? 0}-${idx}`;
        let src = item.url;
        // Data URLs are used directly. Uploaded files that are saved will have a relative path.
        if (item.source === 'upload' && !isDataURL(src)) {
          // Assuming saved uploads are served from a known endpoint if not a data URL
          // No change needed if the URL is already a correct relative path like '/user-uploads/...'
        }
        return {
          ...item,
          key,
          src: src, // URL for display
          fullSrc: src, // URL for zoom
        };
      })
  );
});

const hasAttachments = computed(() => attachmentMediaItems.value.length > 0);

function handleAttachmentClick(mediaItem: (typeof attachmentMediaItems.value)[0]) {
  if (isSelectionMode.value) return; // Disable zoom in selection mode

  if (mediaItem.type === 'image') {
    const tools = computed<ZoomedAvatarTool[]>(() => {
      const currentIgnored = props.message.extra?.ignored_media ?? [];
      const isIgnored = currentIgnored.includes(mediaItem.src);
      return [
        {
          id: 'toggle-ignore-image',
          icon: isIgnored ? 'eye' : 'eye-slash',
          title: isIgnored ? t('chat.buttons.unignoreImage') : t('chat.buttons.ignoreImage'),
          onClick: () => {
            toggleIgnoredMedia(mediaItem.src);
          },
        },
      ];
    });

    uiStore.toggleZoomedAvatar({
      src: mediaItem.fullSrc,
      charName: mediaItem.title || 'Image',
      tools,
    });
  }
  // Could add handlers for video/audio later
}

function toggleIgnoredMedia(url: string) {
  const currentIgnored = props.message.extra?.ignored_media ?? [];
  const isIgnored = currentIgnored.includes(url);

  let newIgnored: string[];
  if (isIgnored) {
    newIgnored = currentIgnored.filter((u) => u !== url);
  } else {
    newIgnored = [...currentIgnored, url];
  }

  // Create a new extra object to ensure reactivity
  const newExtra = {
    ...props.message.extra,
    ignored_media: newIgnored.length > 0 ? newIgnored : undefined,
  };
  if (newExtra.ignored_media === undefined) {
    delete newExtra.ignored_media;
  }

  chatStore.updateMessageObject(props.index, { extra: newExtra });
}

function handleContentClick(event: MouseEvent) {
  if (isSelectionMode.value) return;

  const target = event.target as HTMLElement;
  if (target.tagName === 'IMG' && target.classList.contains('message-content-image')) {
    const imgElement = target as HTMLImageElement;
    const src = imgElement.src;
    const alt = imgElement.alt || 'Inline Image';

    const tools = computed<ZoomedAvatarTool[]>(() => {
      const currentIgnored = props.message.extra?.ignored_media ?? [];
      const isIgnored = currentIgnored.includes(src);

      return [
        {
          id: 'toggle-ignore-image',
          icon: isIgnored ? 'eye' : 'eye-slash',
          title: isIgnored ? t('chat.buttons.unignoreImage') : t('chat.buttons.ignoreImage'),
          onClick: () => {
            toggleIgnoredMedia(src);
          },
        },
      ];
    });

    uiStore.toggleZoomedAvatar({
      src,
      charName: alt,
      tools,
    });
  }
}

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
  const data = promptStore.getItemizedPrompt(props.index, props.message.swipe_id ?? 0);
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

function toggleHidden() {
  chatStore.updateMessageObject(props.index, { is_system: !props.message.is_system });
}

const editTools = computed<TextareaToolDefinition[]>(() => {
  return [
    {
      id: 'confirm-edit',
      icon: 'fa-check',
      title: t('chat.buttons.confirmEdit'),
      variant: 'confirm',
      onClick: () => saveEdit(),
    },
    {
      id: 'toggle-reasoning',
      icon: 'fa-lightbulb',
      title: t('chat.buttons.addReasoning'),
      active: isEditingReasoning.value,
      onClick: () => toggleReasoningEdit(),
    },
    {
      id: 'move-up',
      icon: 'fa-chevron-up',
      title: t('chat.buttons.moveUp'),
      onClick: () => moveUp(),
    },
    {
      id: 'move-down',
      icon: 'fa-chevron-down',
      title: t('chat.buttons.moveDown'),
      onClick: () => moveDown(),
    },
    {
      id: 'cancel-edit',
      icon: 'fa-xmark',
      title: t('common.cancel'),
      variant: 'danger',
      onClick: () => cancelEdit(),
    },
  ];
});
</script>

<template>
  <article
    class="message"
    :class="{
      'is-user': message.is_user,
      'is-bot': !message.is_user,
      'is-selected': isSelected,
      'is-selection-mode': isSelectionMode,
      'animations-disabled': animationsDisabled,
      'is-system-message': message.is_system,
      'is-small-sys': isSmallSys,
    }"
    :data-message-index="index"
    :aria-label="`${props.message.name} - ${formattedTimestamp}`"
    @click="handleSelectionClick"
  >
    <!-- Selection Overlay -->
    <div v-if="isSelectionMode" class="message-selection-overlay" aria-hidden="true">
      <div class="selection-checkbox" :class="{ checked: isSelected }">
        <i v-if="isSelected" class="fa-solid fa-check"></i>
      </div>
    </div>

    <div class="message-avatar-wrapper">
      <div
        class="message-avatar"
        role="button"
        tabindex="0"
        :aria-label="props.message.name"
        @click.stop="handleAvatarClick"
        @keydown.enter.stop.prevent="handleAvatarClick"
        @keydown.space.stop.prevent="handleAvatarClick"
      >
        <SmartAvatar :urls="[avatarUrls.thumbnail]" :alt="`${props.message.name} Avatar`" />
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
          <span class="message-name">{{ props.message.name }}</span>
          <small class="message-timestamp">{{ formattedTimestamp }}</small>
        </div>

        <!-- Buttons for Normal Mode -->
        <div v-show="!isEditing && !isSelectionMode" class="message-buttons">
          <Button
            v-if="hasItemizedPrompt && !isSmallSys"
            variant="ghost"
            icon="fa-square-poll-horizontal"
            :title="t('chat.buttons.itemization')"
            @click="showPromptItemization"
          />
          <Button variant="ghost" icon="fa-copy" :title="t('chat.buttons.copyMessage')" @click="copyMessage" />
          <Button
            v-if="!isSmallSys"
            variant="ghost"
            :icon="message.is_system ? 'fa-eye' : 'fa-eye-slash'"
            :title="message.is_system ? t('chat.buttons.showInPrompt') : t('chat.buttons.hideFromPrompt')"
            @click="toggleHidden"
          />
          <Button v-if="!isSmallSys" variant="ghost" icon="fa-pencil" title="Edit" @click="startEditing" />
          <Button
            icon="fa-trash-can"
            variant="danger"
            :title="t('chat.buttons.deleteMessage')"
            @click="handleDeleteClick"
          />
        </div>
      </div>

      <div v-if="!isEditing && hasReasoning" class="message-reasoning">
        <div
          class="message-reasoning-header"
          role="button"
          tabindex="0"
          :aria-expanded="!isReasoningCollapsed"
          :aria-label="t('chat.reasoning.title')"
          @click.stop="isReasoningCollapsed = !isReasoningCollapsed"
          @keydown.enter.stop.prevent="isReasoningCollapsed = !isReasoningCollapsed"
          @keydown.space.stop.prevent="isReasoningCollapsed = !isReasoningCollapsed"
        >
          <span>{{ t('chat.reasoning.title') }}</span>
          <i
            class="fa-solid"
            :class="isReasoningCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'"
            aria-hidden="true"
          ></i>
        </div>
        <transition name="expand">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-show="!isReasoningCollapsed" class="message-reasoning-content" v-html="formattedReasoning"></div>
        </transition>
      </div>

      <!-- eslint-disable-next-line vue/no-v-html -->
      <div
        v-show="!isEditing && formattedContent"
        class="message-content"
        @click="handleContentClick"
        v-html="formattedContent"
      ></div>

      <div v-if="!isEditing && hasAttachments" class="message-media-container">
        <div
          v-for="item in attachmentMediaItems"
          :key="item.key"
          class="media-item"
          role="button"
          tabindex="0"
          :aria-label="`View media: ${item.title || item.type}`"
          @click.stop="handleAttachmentClick(item)"
          @keydown.enter.stop.prevent="handleAttachmentClick(item)"
          @keydown.space.stop.prevent="handleAttachmentClick(item)"
        >
          <img v-if="item.type === 'image'" :src="item.src" :alt="item.title || 'Image content'" />
          <div v-else class="media-placeholder">
            <i v-if="item.type === 'video'" class="fa-solid fa-film"></i>
            <i v-else-if="item.type === 'audio'" class="fa-solid fa-volume-high"></i>
            <i v-else class="fa-solid fa-file"></i>
            <span>{{ item.title || item.type }}</span>
          </div>
        </div>
      </div>

      <div v-show="isEditing" class="message-edit-area">
        <transition name="expand">
          <div v-show="isEditingReasoning" class="message-reasoning-edit-area">
            <Textarea
              v-model="editedReasoning"
              identifier="chat.edit_message"
              :label="t('chat.reasoning.title')"
              :rows="3"
              resizable
              allow-maximize
            />
          </div>
        </transition>
        <Textarea
          ref="editTextarea"
          v-model="editedContent"
          identifier="chat.edit_message"
          :rows="5"
          resizable
          allow-maximize
          :tools="editTools"
          @keydown="handleEditKeydown"
        />
      </div>

      <div v-show="canSwipe && !isSelectionMode" class="message-footer">
        <div class="message-swipe-controls">
          <i
            class="swipe-arrow fa-solid fa-chevron-left"
            role="button"
            tabindex="0"
            :title="t('chat.buttons.swipeLeft')"
            :aria-label="t('chat.buttons.swipeLeft')"
            @click="swipe('left')"
            @keydown.enter.prevent="swipe('left')"
            @keydown.space.prevent="swipe('left')"
          ></i>
          <span class="swipe-counter" aria-live="polite"
            >{{ (message.swipe_id ?? 0) + 1 }} / {{ message.swipes?.length ?? 0 }}</span
          >
          <i
            class="swipe-arrow fa-solid fa-chevron-right"
            role="button"
            tabindex="0"
            :title="t('chat.buttons.swipeRight')"
            :aria-label="t('chat.buttons.swipeRight')"
            @click="swipe('right')"
            @keydown.enter.prevent="swipe('right')"
            @keydown.space.prevent="swipe('right')"
          ></i>
        </div>
      </div>
      <!-- TODO: Implement media, etc. -->
    </div>
  </article>
</template>
