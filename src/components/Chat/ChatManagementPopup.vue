<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useChatStore } from '../../stores/chat.store';
import { useCharacterStore } from '../../stores/character.store';
import { usePopupStore } from '../../stores/popup.store';
import { POPUP_RESULT, POPUP_TYPE, type ChatInfo } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { humanizedDateTime } from '../../utils/date';
import * as api from '../../api/chat';
import { toast } from '../../composables/useToast';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);

const { t } = useStrictI18n();
const chatStore = useChatStore();
const characterStore = useCharacterStore();
const popupStore = usePopupStore();
const dialog = ref<HTMLDialogElement | null>(null);
const chats = ref<ChatInfo[]>([]);

async function fetchChatList() {
  if (!characterStore.activeCharacter) return;
  try {
    chats.value = await api.listChatsForCharacter(characterStore.activeCharacter);
  } catch {
    toast.error(t('chatManagement.errors.fetch'));
  }
}

onMounted(() => {
  if (props.visible) {
    dialog.value?.showModal();
    fetchChatList();
  }
});

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      dialog.value?.showModal();
      fetchChatList();
    } else {
      dialog.value?.close();
    }
  },
);

function close() {
  emit('close');
}

async function selectChat(chatFile: string) {
  await chatStore.setActiveChatFile(chatFile);
  close();
}

async function createNewChat() {
  const { result, value: newName } = await popupStore.show({
    title: t('chatManagement.newChat'),
    content: t('chatManagement.createPrompt'),
    type: POPUP_TYPE.INPUT,
    inputValue: `${characterStore.activeCharacterName} - ${humanizedDateTime()}`,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && newName && characterStore.activeCharacter) {
    const newFileName = `${newName.trim()}`;
    try {
      await api.saveChat(characterStore.activeCharacter, newFileName);
      await selectChat(newFileName);
    } catch {
      toast.error(t('chatManagement.errors.create'));
    }
  }
}

async function renameChat(oldFile: string) {
  const { result, value: newName } = await popupStore.show({
    title: t('chatManagement.actions.rename'),
    content: t('chatManagement.renamePrompt'),
    type: POPUP_TYPE.INPUT,
    inputValue: oldFile,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && newName && characterStore.activeCharacter) {
    let newFileName = newName.trim();
    try {
      // TODO: Implement group chat
      newFileName = (await api.renameChat(characterStore.activeCharacter, oldFile, newFileName, false)).newFileName;
      if (chatStore.activeChatFile === oldFile) {
        chatStore.activeChatFile = newFileName;
      }
      fetchChatList();
    } catch {
      toast.error(t('chatManagement.errors.rename'));
    }
  }
}

async function deleteChat(chatFile: string) {
  const { result } = await popupStore.show({
    title: t('chatManagement.deleteConfirmTitle'),
    content: t('chatManagement.deleteConfirmContent', { chatFile }),
    type: POPUP_TYPE.CONFIRM,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && characterStore.activeCharacter) {
    try {
      await api.deleteChat(characterStore.activeCharacter, chatFile);
      if (chatStore.activeChatFile === chatFile && chats.value) {
        // If we deleted the active chat, switch to another one or create a new one
        const remainingChats = chats.value.filter((f) => f.file_id !== chatFile);
        if (remainingChats.length > 0) {
          await selectChat(remainingChats[0].file_id);
        } else {
          await createNewChat();
        }
      }
      fetchChatList();
    } catch {
      toast.error(t('chatManagement.errors.delete'));
    }
  }
}
</script>

<template>
  <dialog id="chat-management-popup" ref="dialog" class="popup wide" @cancel="close">
    <div class="popup-body">
      <h3>
        {{ t('chatManagement.title', { characterName: characterStore.activeCharacterName }) }}
      </h3>
      <div class="chat-management-popup-actions">
        <button class="menu-button" @click="createNewChat">{{ t('chatManagement.newChat') }}</button>
      </div>
      <div class="chat-management-popup-list">
        <table>
          <tbody>
            <tr v-for="file in chats" :key="file.file_id" class="chat-file-row" :data-file="file.file_id">
              <td class="chat-file-name">
                <span v-show="chatStore.activeChatFile === file.file_id" class="active-indicator">
                  {{ t('chatManagement.active') }}
                </span>
                {{ file.file_id }}
              </td>
              <td class="chat-file-actions">
                <button
                  class="menu-button"
                  :disabled="chatStore.activeChatFile === file.file_id"
                  :title="t('chatManagement.actions.select')"
                  @click="selectChat(file.file_id)"
                >
                  <i class="fa-solid fa-check"></i>
                </button>
                <button
                  class="menu-button"
                  :title="t('chatManagement.actions.rename')"
                  @click="renameChat(file.file_id)"
                >
                  <i class="fa-solid fa-pencil"></i>
                </button>
                <button
                  class="menu-button menu-button--danger"
                  :title="t('chatManagement.actions.delete')"
                  @click="deleteChat(file.file_id)"
                >
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="popup-controls">
        <button class="menu-button" @click="close">{{ t('common.cancel') }}</button>
      </div>
    </div>
  </dialog>
</template>
