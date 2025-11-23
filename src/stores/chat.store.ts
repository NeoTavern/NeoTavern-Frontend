import { defineStore } from 'pinia';
import { computed, nextTick, ref, watch } from 'vue';
import { debounce } from 'lodash-es';
import {
  type ChatMessage,
  type ChatMetadata,
  type FullChat,
  type ChatHeader,
  type ChatInfo,
  POPUP_TYPE,
  POPUP_RESULT,
} from '../types';
import { usePromptStore } from './prompt.store';
import { useCharacterStore } from './character.store';
import { useUiStore } from './ui.store';
import { fetchChat, saveChat as apiSaveChat, saveChat } from '../api/chat';
import { uuidv4 } from '../utils/common';
import { getFirstMessage } from '../utils/chat';
import { toast } from '../composables/useToast';
import { useStrictI18n } from '../composables/useStrictI18n';
import {
  DEFAULT_SAVE_EDIT_TIMEOUT,
  GenerationMode,
  GroupGenerationHandlingMode,
  GroupReplyStrategy,
} from '../constants';
import { useSettingsStore } from './settings.store';
import { usePersonaStore } from './persona.store';
import { eventEmitter } from '../utils/event-emitter';
import { useWorldInfoStore } from './world-info.store';
import { usePopupStore } from './popup.store';
import { convertCharacterBookToWorldInfoBook } from '../utils/world-info-conversion';
import { useChatGeneration } from '../composables/useChatGeneration';

export type ChatStoreState = {
  messages: ChatMessage[];
  metadata: ChatMetadata;
};

export type ChatMessageEditState = {
  index: number;
  originalContent: string;
};

export const useChatStore = defineStore('chat', () => {
  const { t } = useStrictI18n();

  const activeChat = ref<ChatStoreState | null>(null);
  const activeChatFile = ref<string | null>(null);
  const activeMessageEditState = ref<ChatMessageEditState | null>(null);
  const isChatLoading = ref(false);
  const chatInfos = ref<ChatInfo[]>([]);
  const recentChats = ref<ChatInfo[]>([]);
  const autoModeTimer = ref<ReturnType<typeof setTimeout> | null>(null);

  const uiStore = useUiStore();
  const personaStore = usePersonaStore();
  const characterStore = useCharacterStore();
  const promptStore = usePromptStore();
  const settingsStore = useSettingsStore();
  const worldInfoStore = useWorldInfoStore();
  const popupStore = usePopupStore();

  const chatsMetadataByCharacterAvatars = computed(() => {
    const mapping: Record<string, ChatInfo[]> = {};
    for (const chatInfo of chatInfos.value) {
      for (const memberAvatar of chatInfo.chat_metadata.members || []) {
        if (!mapping[memberAvatar]) {
          mapping[memberAvatar] = [];
        }
        mapping[memberAvatar].push(chatInfo);
      }
    }
    return mapping;
  });

  const isGroupChat = computed(() => {
    return activeChat.value && (activeChat.value.metadata.members?.length ?? 0) > 1;
  });

  const groupConfig = computed(() => {
    if (!activeChat.value) return null;

    // Initialize defaults if missing
    if (!activeChat.value.metadata.group) {
      activeChat.value.metadata.group = {
        config: {
          replyStrategy: GroupReplyStrategy.NATURAL_ORDER,
          handlingMode: GroupGenerationHandlingMode.SWAP,
          allowSelfResponses: false,
          autoMode: 0,
        },
        members: {},
      };
      // Sync members list status
      activeChat.value.metadata.members?.forEach((avatar) => {
        if (activeChat.value!.metadata.group) {
          activeChat.value!.metadata.group.members[avatar] = { muted: false };
        }
      });
    }
    return activeChat.value.metadata.group;
  });

  async function syncSwipeToMes(messageIndex: number, swipeIndex: number) {
    if (!activeChat.value || messageIndex < 0 || messageIndex >= activeChat.value.messages.length) return;

    const message = activeChat.value.messages[messageIndex];
    if (!message || !Array.isArray(message.swipes) || swipeIndex < 0 || swipeIndex >= message.swipes.length) {
      return;
    }

    message.swipe_id = swipeIndex;
    message.mes = message.swipes[swipeIndex];

    const swipeInfo = message.swipe_info?.[swipeIndex];
    if (swipeInfo) {
      message.send_date = swipeInfo.send_date;
      message.gen_started = swipeInfo.gen_started;
      message.gen_finished = swipeInfo.gen_finished;
      message.extra = { ...swipeInfo.extra };
    }

    if (message.extra) {
      delete message.extra.display_text;
      delete message.extra.reasoning_display_text;
    }
    await nextTick();
    await eventEmitter.emit('message:updated', messageIndex, message);
  }

  function stopAutoModeTimer() {
    if (autoModeTimer.value) {
      clearTimeout(autoModeTimer.value);
      autoModeTimer.value = null;
    }
  }

  const { isGenerating, generateResponse, abortGeneration, sendMessage } = useChatGeneration({
    activeChat,
    groupConfig,
    syncSwipeToMes,
    stopAutoModeTimer,
  });

  const saveChatDebounced = debounce(async () => {
    if (!activeChat.value || !activeChatFile.value) {
      return;
    }

    try {
      uiStore.isChatSaving = true;
      const chatToSave: FullChat = [
        {
          chat_metadata: activeChat.value.metadata,
        },
        ...activeChat.value.messages,
      ];
      await apiSaveChat(activeChatFile.value, chatToSave);

      await promptStore.saveItemizedPrompts(activeChatFile.value);
      const chatInfo = chatInfos.value.find((c) => c.file_name === activeChatFile.value)?.chat_metadata;
      if (chatInfo) {
        chatInfo.chat_metadata = activeChat.value.metadata;
      }
      const recentChatInfo = recentChats.value.find((c) => c.file_name === activeChatFile.value)?.chat_metadata;
      if (recentChatInfo) {
        recentChatInfo.chat_metadata = activeChat.value.metadata;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Failed to save chat:', err);
      toast.error(err.message || 'An unknown error occurred while saving the chat.');
    } finally {
      uiStore.isChatSaving = false;
    }
  }, DEFAULT_SAVE_EDIT_TIMEOUT);

  watch(
    [activeChat],
    () => {
      nextTick(async () => {
        if (activeChatFile.value) {
          await eventEmitter.emit('chat:updated', activeChatFile.value);
        }
      });

      if (!isChatLoading.value && activeChat.value) {
        saveChatDebounced();
      }
    },
    { deep: true },
  );

  watch(
    () => isGenerating.value,
    (generating) => {
      if (!generating && groupConfig.value?.config.autoMode && groupConfig.value.config.autoMode > 0) {
        startAutoModeTimer();
      } else {
        stopAutoModeTimer();
      }
    },
  );

  function startAutoModeTimer() {
    stopAutoModeTimer();
    if (!groupConfig.value?.config.autoMode) return;

    autoModeTimer.value = setTimeout(() => {
      generateResponse(GenerationMode.NEW);
    }, groupConfig.value.config.autoMode * 1000);
  }


  async function clearChat(recreateFirstMessage = false) {
    if (!activeChat.value) return;
    isChatLoading.value = true;

    saveChatDebounced.cancel();
    activeChat.value.messages = [];

    activeChatFile.value = null;

    promptStore.extensionPrompts = {};
    promptStore.itemizedPrompts = [];

    await nextTick();
    await eventEmitter.emit('chat:cleared');

    if (recreateFirstMessage && characterStore.activeCharacters.length > 0) {
      // Group chat? Recreate first message for the *primary* character (first in list)
      const activeCharacter = characterStore.activeCharacters[0];
      if (activeCharacter) {
        const firstMessage = getFirstMessage(activeCharacter);
        if (firstMessage?.mes) {
          activeChat.value.messages.push(firstMessage);
          await nextTick();
          await eventEmitter.emit('message:created', firstMessage);
        }
      }
    }

    isChatLoading.value = false;
  }

  async function setActiveChatFile(chatFile: string) {
    if (activeChatFile.value === chatFile) return;
    await clearChat(false);

    // TODO: unshallow character logic if needed
    isChatLoading.value = true;

    try {
      const response = await fetchChat(chatFile);
      if (response.length > 0) {
        const metadataItem = response.shift() as ChatHeader;
        activeChatFile.value = chatFile;
        activeChat.value = {
          metadata: metadataItem.chat_metadata,
          messages: response as ChatMessage[],
        };
      }

      if (activeChatFile.value) {
        for (const character of characterStore.activeCharacters) {
          const changes = characterStore.getDifferences(character, { ...character, chat: activeChatFile.value });
          if (changes) {
            await characterStore.updateAndSaveCharacter(character.avatar, changes);
          }
        }

        // Check for embedded lorebooks in characters
        if (activeChat.value) {
          const nextMembers = activeChat.value.metadata.members || [];
          for (const member of nextMembers) {
            const character = characterStore.characters.find((c) => c.avatar === member);
            if (character?.data?.character_book?.name) {
              const bookName = character.data.character_book.name;
              // Check if book exists globally
              const exists = worldInfoStore.bookInfos.find((b) => b.name === bookName);
              if (!exists) {
                // Ask to import
                const { result } = await popupStore.show({
                  title: t('worldInfo.popup.importEmbeddedTitle'),
                  content: t('worldInfo.popup.importEmbeddedContent', { name: bookName }),
                  type: POPUP_TYPE.CONFIRM,
                });

                if (result === POPUP_RESULT.AFFIRMATIVE) {
                  await worldInfoStore.createNewBook({
                    filename: uuidv4(),
                    book: convertCharacterBookToWorldInfoBook(character.data.character_book),
                  });
                  toast.success(t('worldInfo.importSuccess', { name: bookName }));
                }
              }
            }
          }
        }

        await promptStore.loadItemizedPrompts(activeChatFile.value);

        // Persona Switching Logic
        const meta = activeChat.value!.metadata;
        if (meta.active_persona) {
          await personaStore.setActivePersona(meta.active_persona);
        } else if (activeChat.value!.metadata.members?.length === 1) {
          const charAvatar = activeChat.value!.metadata.members[0];
          const linkedPersona = personaStore.getLinkedPersona(charAvatar);
          if (linkedPersona) {
            await personaStore.setActivePersona(linkedPersona.avatarId);
          } else if (settingsStore.settings.persona.defaultPersonaId) {
            await personaStore.setActivePersona(settingsStore.settings.persona.defaultPersonaId);
          }
        } else if (settingsStore.settings.persona.defaultPersonaId) {
          await personaStore.setActivePersona(settingsStore.settings.persona.defaultPersonaId);
        }

        await nextTick();
        await eventEmitter.emit('chat:entered', activeChatFile.value as string);
      }
    } catch (error) {
      console.error('Failed to refresh chat:', error);
      toast.error(t('chat.loadError'));
    } finally {
      isChatLoading.value = false;
    }
  }

  async function createNewChatForCharacter(avatar: string, chatName: string) {
    const character = characterStore.characters.find((c) => c.avatar === avatar);
    if (!character) {
      throw new Error('Character not found for creating new chat.');
    }

    try {
      isChatLoading.value = true;

      const filename = uuidv4();
      const fullFilename = `${filename}.jsonl`;

      const firstMessage = getFirstMessage(character);
      activeChat.value = {
        metadata: {
          members: [character.avatar],
          integrity: uuidv4(),
          promptOverrides: { scenario: '' },
          name: chatName,
        },
        messages: firstMessage && firstMessage.mes ? [firstMessage] : [],
      };
      const fullChat: FullChat = [{ chat_metadata: activeChat.value.metadata }, ...activeChat.value.messages];
      await saveChat(filename, fullChat);
      characterStore.updateAndSaveCharacter(character.avatar, { chat: filename });

      activeChatFile.value = filename;
      const cInfo: ChatInfo = {
        chat_metadata: activeChat.value.metadata,
        chat_items: activeChat.value.messages.length,
        file_id: filename,
        file_name: fullFilename,
        file_size: JSON.stringify(fullChat).length,
        last_mes: Date.now(),
        mes: firstMessage?.mes || '',
      };
      chatInfos.value.push(cInfo);
      recentChats.value.push(cInfo);

      await nextTick();
      await eventEmitter.emit('chat:entered', filename);
      if (firstMessage?.mes) {
        await eventEmitter.emit('message:created', firstMessage);
      }
    } catch (error) {
      console.error('Failed to create new chat:', error);
      toast.error(t('chat.createError'));
    } finally {
      isChatLoading.value = false;
    }
  }

  async function updateChatName(fileId: string, newName: string) {
    const chatInfo = chatInfos.value.find((c) => c.file_id === fileId);
    if (!chatInfo) return;

    if (activeChatFile.value === fileId && activeChat.value) {
      activeChat.value.metadata.name = newName;
      chatInfo.chat_metadata.name = newName;
      saveChatDebounced();
    } else {
      try {
        const response = await fetchChat(fileId);
        if (response.length > 0) {
          const metadataItem = response[0] as ChatHeader;
          metadataItem.chat_metadata.name = newName;
          await saveChat(fileId, response as FullChat);
          chatInfo.chat_metadata.name = newName;
        }
      } catch (error) {
        console.error('Failed to update chat name', error);
        toast.error(t('chat.renameError'));
      }
    }
  }

  async function toggleChatPersona(personaId: string) {
    if (!activeChat.value) return;

    if (activeChat.value.metadata.active_persona === personaId) {
      delete activeChat.value.metadata.active_persona;
      toast.info(t('personaManagement.connections.chatRemoved'));
    } else {
      activeChat.value.metadata.active_persona = personaId;
      toast.success(t('personaManagement.connections.chatAdded'));
    }
    saveChatDebounced();
  }

  async function syncPersonaName(personaId: string, newName: string) {
    if (!activeChat.value) return;

    let updatedCount = 0;
    const messages = activeChat.value.messages;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.original_avatar === personaId && msg.name !== newName) {
        msg.name = newName;
        updatedCount++;
        await eventEmitter.emit('message:updated', i, msg);
      }
    }

    if (updatedCount > 0) {
      saveChatDebounced();
      toast.success(t('personaManagement.syncName.success', { count: updatedCount }));
    } else {
      toast.info(t('personaManagement.syncName.noChanges'));
    }
  }

  function toggleMemberMute(avatar: string) {
    if (!activeChat.value?.metadata.group) return;
    const member = activeChat.value.metadata.group.members[avatar];
    if (member) {
      member.muted = !member.muted;
      saveChatDebounced();
    }
  }

  async function addMember(avatar: string) {
    if (!activeChat.value) return;
    if (activeChat.value.metadata.members?.includes(avatar)) return;

    activeChat.value.metadata.members?.push(avatar);

    if (!activeChat.value.metadata.group) {
      activeChat.value.metadata.group = {
        config: {
          replyStrategy: GroupReplyStrategy.NATURAL_ORDER,
          handlingMode: GroupGenerationHandlingMode.SWAP,
          allowSelfResponses: false,
          autoMode: 0,
        },
        members: {},
      };
    }
    if (!activeChat.value.metadata.group.members[avatar]) {
      activeChat.value.metadata.group.members[avatar] = { muted: false };
    }

    saveChatDebounced();
  }

  async function removeMember(avatar: string) {
    if (!activeChat.value) return;
    const index = activeChat.value.metadata.members?.indexOf(avatar) ?? -1;
    if (index > -1) {
      activeChat.value.metadata.members?.splice(index, 1);
      if (activeChat.value.metadata.group?.members[avatar]) {
        delete activeChat.value.metadata.group.members[avatar];
      }
      saveChatDebounced();
    }
  }

  function startEditing(index: number) {
    if (!activeChat.value || index < 0 || index >= activeChat.value.messages.length) return;
    activeMessageEditState.value = {
      index,
      originalContent: activeChat.value.messages[index].mes,
    };
  }

  function cancelEditing() {
    activeMessageEditState.value = null;
  }

  async function saveMessageEdit(newContent: string, newReasoning?: string) {
    if (activeMessageEditState.value !== null && activeChat.value) {
      const index = activeMessageEditState.value.index;
      const message = activeChat.value.messages[index];
      message.mes = newContent;
      if (message.extra) {
        delete message.extra.display_text;
        delete message.extra.reasoning_display_text;
      }

      if (typeof newReasoning === 'string' && newReasoning.trim() !== '') {
        if (!message.extra) message.extra = {};
        message.extra.reasoning = newReasoning;
      } else {
        if (message.extra) {
          delete message.extra.reasoning;
        }
      }

      if (message.swipes && typeof message.swipe_id === 'number' && message.swipes[message.swipe_id] !== undefined) {
        message.swipes[message.swipe_id] = newContent;
      }

      const swipeInfo = message.swipe_info?.[message.swipe_id ?? 0];
      if (swipeInfo) {
        if (!swipeInfo.extra) swipeInfo.extra = {};
        if (typeof newReasoning === 'string' && newReasoning.trim() !== '') {
          swipeInfo.extra.reasoning = newReasoning;
        } else {
          delete swipeInfo.extra.reasoning;
        }
      }

      cancelEditing();
      await nextTick();
      await eventEmitter.emit('message:updated', index, message);
    }
  }

  async function updateMessageObject(index: number, updates: Partial<ChatMessage>): Promise<void> {
    if (!activeChat.value || index < 0 || index >= activeChat.value.messages.length) {
      console.warn(`[ChatStore] updateMessageObject: index ${index} out of bounds.`);
      return;
    }
    const message = activeChat.value.messages[index];
    Object.assign(message, updates);

    if (updates.mes !== undefined) {
      if (message.swipes && typeof message.swipe_id === 'number' && message.swipes[message.swipe_id] !== undefined) {
        message.swipes[message.swipe_id] = updates.mes;
      }
    }

    await nextTick();
    await eventEmitter.emit('message:updated', index, message);
  }

  async function swipeMessage(messageIndex: number, direction: 'left' | 'right') {
    if (!activeChat.value || messageIndex < 0 || messageIndex >= activeChat.value.messages.length) return;
    const message = activeChat.value.messages[messageIndex];
    if (!message || !Array.isArray(message.swipes)) return;

    let currentSwipeId = message.swipe_id ?? 0;
    const swipeCount = message.swipes.length;

    if (direction === 'left') {
      currentSwipeId = (currentSwipeId - 1 + swipeCount) % swipeCount;
      await syncSwipeToMes(messageIndex, currentSwipeId);
    } else {
      if (currentSwipeId < swipeCount - 1) {
        currentSwipeId++;
        await syncSwipeToMes(messageIndex, currentSwipeId);
      } else {
        await generateResponse(GenerationMode.ADD_SWIPE);
      }
    }
  }

  async function deleteMessage(index: number) {
    if (!activeChat.value || index < 0 || index >= activeChat.value.messages.length) return;
    activeChat.value.messages.splice(index, 1);
    if (activeMessageEditState.value?.index === index) {
      cancelEditing();
    }
    await nextTick();
    await eventEmitter.emit('message:deleted', index);
  }

  async function deleteSwipe(messageIndex: number, swipeIndex: number) {
    if (!activeChat.value || messageIndex < 0 || messageIndex >= activeChat.value.messages.length) return;
    const message = activeChat.value.messages[messageIndex];
    if (
      !message ||
      !Array.isArray(message.swipes) ||
      message.swipes.length <= 1 ||
      swipeIndex < 0 ||
      swipeIndex >= message.swipes.length
    ) {
      toast.error(t('chat.delete.lastSwipeError'));
      return;
    }

    message.swipes.splice(swipeIndex, 1);
    if (Array.isArray(message.swipe_info)) {
      message.swipe_info.splice(swipeIndex, 1);
    }

    const newSwipeId = Math.min(swipeIndex, message.swipes.length - 1);
    await syncSwipeToMes(messageIndex, newSwipeId);
  }

  function moveMessage(index: number, direction: 'up' | 'down') {
    if (!activeChat.value || index < 0 || index >= activeChat.value.messages.length) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= activeChat.value.messages.length) return;

    [activeChat.value.messages[index], activeChat.value.messages[newIndex]] = [
      activeChat.value.messages[newIndex],
      activeChat.value.messages[index],
    ];

    if (activeMessageEditState.value) {
      if (activeMessageEditState.value.index === index) {
        activeMessageEditState.value.index = newIndex;
      } else if (activeMessageEditState.value.index === newIndex) {
        activeMessageEditState.value.index = index;
      }
    }
  }

  return {
    activeChat,
    chatInfos,
    recentChats,
    activeMessageEditState,
    isGenerating,
    activeChatFile,
    isGroupChat,
    groupConfig,
    chatsMetadataByCharacterAvatars,
    clearChat,
    sendMessage,
    generateResponse,
    abortGeneration,
    startEditing,
    cancelEditing,
    saveMessageEdit,
    updateMessageObject,
    deleteMessage,
    deleteSwipe,
    swipeMessage,
    moveMessage,
    setActiveChatFile,
    createNewChatForCharacter,
    toggleMemberMute,
    addMember,
    removeMember,
    toggleChatPersona,
    syncPersonaName,
    updateChatName,
    syncSwipeToMes,
  };
});
