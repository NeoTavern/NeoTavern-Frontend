import { defineStore } from 'pinia';
import { computed, nextTick, ref, watch } from 'vue';
import { type ChatExportRequest } from '../api/chat';
import { useAutoSave } from '../composables/useAutoSave';
import { useChatGeneration } from '../composables/useChatGeneration';
import { useStrictI18n } from '../composables/useStrictI18n';
import { EventPriority, GenerationMode } from '../constants';
import { chatService } from '../services/chat.service';
import {
  POPUP_RESULT,
  POPUP_TYPE,
  type Character,
  type ChatHeader,
  type ChatInfo,
  type ChatMessage,
  type ChatMetadata,
  type FullChat,
} from '../types';
import { getCharacterDifferences } from '../utils/character';
import { getFirstMessage } from '../utils/chat';
import { downloadFile, formatFileSize, getMessageTimeStamp, uuidv4 } from '../utils/commons';
import { eventEmitter } from '../utils/extensions';
import { useCharacterStore } from './character.store';
import { useChatSelectionStore } from './chat-selection.store';
import { useChatUiStore } from './chat-ui.store';
import { usePersonaStore } from './persona.store';
import { usePopupStore } from './popup.store';
import { usePromptStore } from './prompt.store';
import { useSettingsStore } from './settings.store';
import { useUiStore } from './ui.store';

export type ChatStoreState = {
  messages: ChatMessage[];
  metadata: ChatMetadata;
};

export const useChatStore = defineStore('chat', () => {
  const activeChat = ref<ChatStoreState | null>(null);
  const activeChatFile = ref<string | null>(null);
  const chatInfos = ref<ChatInfo[]>([]);
  const autoModeTimer = ref<ReturnType<typeof setTimeout> | null>(null);

  const uiStore = useUiStore();
  const chatUiStore = useChatUiStore();
  const selectionStore = useChatSelectionStore();
  const personaStore = usePersonaStore();
  const characterStore = useCharacterStore();
  const promptStore = usePromptStore();
  const settingsStore = useSettingsStore();
  const popupStore = usePopupStore();
  const { t } = useStrictI18n();

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

  // Consolidated Saving Logic
  const { trigger: triggerSave } = useAutoSave(
    async () => {
      if (!activeChat.value || !activeChatFile.value) return;

      uiStore.isChatSaving = true; // Keep UI store in sync for legacy status bar
      try {
        const chatToSave: FullChat = [{ chat_metadata: activeChat.value.metadata }, ...activeChat.value.messages];

        await chatService.save(activeChatFile.value, chatToSave);
        await promptStore.saveItemizedPrompts(activeChatFile.value);

        // Update local cache of infos
        const updateInfo = (infos: ChatInfo[]) => {
          const info = infos.find((c) => c.file_name === activeChatFile.value);
          if (info && activeChat.value) {
            info.chat_metadata = activeChat.value.metadata;
          }
        };
        updateInfo(chatInfos.value);
      } finally {
        uiStore.isChatSaving = false;
      }
    },
    { timeout: 1000 },
  );

  async function syncSwipeToMes(messageIndex: number, swipeIndex: number) {
    if (!activeChat.value || messageIndex < 0 || messageIndex >= activeChat.value.messages.length) return;

    const message = activeChat.value.messages[messageIndex];
    chatService.syncSwipe(message, swipeIndex);

    await nextTick();
    await eventEmitter.emit('message:updated', messageIndex, message);
    triggerSave();
  }

  function stopAutoModeTimer() {
    if (autoModeTimer.value) {
      clearTimeout(autoModeTimer.value);
      autoModeTimer.value = null;
    }
  }

  const { isGenerating, generateResponse, abortGeneration, sendMessage } = useChatGeneration({
    activeChat,
    syncSwipeToMes,
    stopAutoModeTimer,
  });

  eventEmitter.on(
    'generation:finished',
    async () => {
      triggerSave();
    },
    EventPriority.HIGH,
  );
  eventEmitter.on(
    'message:created',
    async () => {
      triggerSave();
    },
    EventPriority.HIGH,
  );
  eventEmitter.on(
    'message:deleted',
    async () => {
      triggerSave();
    },
    EventPriority.HIGH,
  );

  eventEmitter.on(
    'character:deleted',
    async (avatar: string) => {
      const isThereOnlyCharacter =
        activeChat.value?.metadata.members?.length === 1 && activeChat.value.metadata.members[0] === avatar;
      if (isThereOnlyCharacter) {
        await clearChat(true);
      }
    },
    EventPriority.HIGH,
  );

  eventEmitter.on(
    'character:first-message-updated',
    async (avatar: string, charData: Character) => {
      if (
        activeChat.value?.messages.length === 1 &&
        !activeChat.value.messages[0].is_user &&
        activeChat.value.messages[0].original_avatar === avatar
      ) {
        const updatedChar = { ...characterStore.characters.find((c) => c.avatar === avatar), ...charData } as Character;
        const newFirstMessageDetails = getFirstMessage({
          activeCharacter: updatedChar,
          characters: [updatedChar],
          persona: personaStore.activePersona ?? {
            avatarId: '',
            connections: [],
            lorebooks: [],
            description: '',
            name: '',
          },
        });
        if (newFirstMessageDetails) {
          await updateMessageObject(0, {
            mes: newFirstMessageDetails.mes,
            swipes: newFirstMessageDetails.swipes,
            swipe_id: newFirstMessageDetails.swipe_id,
            swipe_info: newFirstMessageDetails.swipe_info,
          });
        }
      }
    },
    EventPriority.HIGH,
  );

  watch(
    () => activeChat.value?.metadata.members,
    (newMembers) => {
      if (newMembers) {
        characterStore.setActiveCharacterAvatars(newMembers);
      } else {
        characterStore.setActiveCharacterAvatars([]);
      }
    },
    { immediate: true, deep: true },
  );

  async function clearChat(recreateFirstMessage = false) {
    chatUiStore.isChatLoading = true;
    triggerSave.cancel();

    if (activeChatFile.value) await promptStore.clearUserTyping(activeChatFile.value);

    if (activeChat.value) activeChat.value.messages = [];
    activeChatFile.value = null;
    activeChat.value = null;

    promptStore.extensionPrompts = {};
    promptStore.itemizedPrompts = [];
    selectionStore.isSelectionMode = false;
    selectionStore.selectedMessageIndices.clear();

    await nextTick();
    await eventEmitter.emit('chat:cleared');

    if (recreateFirstMessage && characterStore.activeCharacters.length > 0) {
      const activeCharacter = characterStore.activeCharacters[0];
      if (activeCharacter) {
        activeChat.value = {
          metadata: {
            members: [activeCharacter.avatar],
            integrity: uuidv4(),
          },
          messages: [],
        };
      }
    }
    chatUiStore.isChatLoading = false;
  }

  async function setActiveChatFile(chatFile: string) {
    if (activeChatFile.value === chatFile) return;

    activeChat.value = null;
    activeChatFile.value = null;
    triggerSave.cancel();
    selectionStore.isSelectionMode = false;
    selectionStore.selectedMessageIndices.clear();
    chatUiStore.isChatLoading = true;

    try {
      const response = await chatService.fetch(chatFile);
      if (response.length > 0) {
        const metadataItem = response.shift() as ChatHeader;
        activeChatFile.value = chatFile;
        activeChat.value = {
          metadata: metadataItem.chat_metadata,
          messages: response as ChatMessage[],
        };

        chatUiStore.resetRenderedMessagesCount(settingsStore.settings.ui.chat.messagesToLoad || 100);
      }

      if (activeChatFile.value) {
        // Update character links
        for (const character of characterStore.activeCharacters) {
          const changes = getCharacterDifferences(character, { ...character, chat: activeChatFile.value });
          if (changes) {
            await characterStore.updateAndSaveCharacter(character.avatar, changes);
          }
        }

        await promptStore.loadItemizedPrompts(activeChatFile.value);

        // Handle Persona linking
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
      throw error;
    } finally {
      chatUiStore.isChatLoading = false;
    }
  }

  async function createNewChatForCharacter(avatar: string, chatName: string) {
    const character = characterStore.characters.find((c) => c.avatar === avatar);
    if (!character) throw new Error('Character not found');

    try {
      chatUiStore.isChatLoading = true;
      const filename = uuidv4();
      const fullFilename = `${filename}.jsonl`;

      const firstMessage = getFirstMessage({
        characters: [character],
        activeCharacter: character,
        persona: personaStore.activePersona ?? {
          avatarId: '',
          connections: [],
          lorebooks: [],
          description: '',
          name: '',
        },
      });
      const metadata: ChatMetadata = {
        members: [character.avatar],
        integrity: uuidv4(),
        promptOverrides: { scenario: '' },
        name: chatName,
      };

      const messages = firstMessage && firstMessage.mes ? [firstMessage] : [];
      activeChat.value = { metadata, messages };

      const fullChat: FullChat = [{ chat_metadata: metadata }, ...messages];
      await chatService.create(filename, fullChat);
      await characterStore.updateAndSaveCharacter(character.avatar, { chat: filename });

      activeChatFile.value = filename;
      const cInfo: ChatInfo = {
        chat_metadata: metadata,
        chat_items: messages.length,
        file_id: filename,
        file_name: fullFilename,
        file_size: formatFileSize(JSON.stringify(fullChat).length),
        last_mes: getMessageTimeStamp(),
        mes: firstMessage?.mes || '',
      };

      chatInfos.value.unshift(cInfo);

      chatUiStore.resetRenderedMessagesCount(settingsStore.settings.ui.chat.messagesToLoad || 100);

      await nextTick();
      await eventEmitter.emit('chat:entered', filename);
      if (firstMessage?.mes) {
        await eventEmitter.emit('message:created', firstMessage);
      }
    } catch (error) {
      console.error('Failed to create new chat:', error);
      throw error;
    } finally {
      chatUiStore.isChatLoading = false;
    }
  }

  async function updateChatName(fileId: string, newName: string) {
    const chatInfo = chatInfos.value.find((c) => c.file_id === fileId);
    if (!chatInfo) return;

    if (activeChatFile.value === fileId && activeChat.value) {
      activeChat.value.metadata.name = newName;
      chatInfo.chat_metadata.name = newName;
      triggerSave();
    } else {
      const response = await chatService.fetch(fileId);
      if (response.length > 0) {
        const metadataItem = response[0] as ChatHeader;
        metadataItem.chat_metadata.name = newName;
        await chatService.save(fileId, response as FullChat);
        chatInfo.chat_metadata.name = newName;
      }
    }
  }

  async function toggleChatPersona(personaId: string): Promise<'added' | 'removed' | undefined> {
    if (!activeChat.value) return;
    let result: 'added' | 'removed';
    if (activeChat.value.metadata.active_persona === personaId) {
      delete activeChat.value.metadata.active_persona;
      result = 'removed';
    } else {
      activeChat.value.metadata.active_persona = personaId;
      result = 'added';
    }
    triggerSave();
    return result;
  }

  async function syncPersonaName(personaId: string, newName: string): Promise<number> {
    if (!activeChat.value) return 0;
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
    if (updatedCount > 0) triggerSave();
    return updatedCount;
  }

  function startEditing(index: number) {
    if (!activeChat.value || index < 0 || index >= activeChat.value.messages.length) return;
    chatUiStore.startEditing(index, activeChat.value.messages[index].mes);
  }

  function cancelEditing() {
    chatUiStore.cancelEditing();
  }

  async function saveMessageEdit(newContent: string, newReasoning?: string) {
    if (chatUiStore.activeMessageEditState !== null && activeChat.value) {
      newContent = newContent.trim();
      if (newReasoning) {
        newReasoning = newReasoning.trim();
      }

      const index = chatUiStore.activeMessageEditState.index;
      const message = activeChat.value.messages[index];
      message.mes = newContent;

      if (message.extra) {
        delete message.extra.display_text;
        delete message.extra.reasoning_display_text;
      }

      if (typeof newReasoning === 'string' && newReasoning.trim() !== '') {
        if (!message.extra) message.extra = {};
        message.extra.reasoning = newReasoning;
      } else if (message.extra) {
        delete message.extra.reasoning;
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
      triggerSave();
    }
  }

  async function updateMessageObject(index: number, updates: Partial<ChatMessage>): Promise<void> {
    if (!activeChat.value || index < 0 || index >= activeChat.value.messages.length) return;
    const message = activeChat.value.messages[index];
    Object.assign(message, updates);

    if (updates.mes !== undefined) {
      if (message.swipes && typeof message.swipe_id === 'number' && message.swipes[message.swipe_id] !== undefined) {
        message.swipes[message.swipe_id] = updates.mes;
      }
    }

    await nextTick();
    await eventEmitter.emit('message:updated', index, message);
    triggerSave();
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
    promptStore.clearItemizedPrompt(index);
    if (chatUiStore.activeMessageEditState?.index === index) {
      cancelEditing();
    }
    await nextTick();
    await eventEmitter.emit('message:deleted', [index]);
    triggerSave();
  }

  async function deleteSelectedMessages() {
    if (!activeChat.value || selectionStore.selectedMessageIndices.size === 0) return;

    const targets = new Set<number>();
    const maxIndex = activeChat.value.messages.length - 1;

    for (const idx of selectionStore.selectedMessageIndices) {
      targets.add(idx);
      if (idx + 1 <= maxIndex) targets.add(idx + 1);
    }

    const indicesToDelete = Array.from(targets).sort((a, b) => b - a);
    const { result } = await popupStore.show({
      title: t('chat.delete.confirmBulkTitle'),
      content: t('chat.delete.confirmBulkContent', { count: indicesToDelete.length }),
      type: POPUP_TYPE.CONFIRM,
    });

    if (result === POPUP_RESULT.AFFIRMATIVE) {
      for (const idx of indicesToDelete) {
        if (idx >= 0 && idx < activeChat.value.messages.length) {
          activeChat.value.messages.splice(idx, 1);
          promptStore.clearItemizedPrompt(idx);
        }
      }
      selectionStore.deselectAll();
      selectionStore.isSelectionMode = false;
      cancelEditing();

      await nextTick();
      await eventEmitter.emit('message:deleted', indicesToDelete);
      triggerSave();
    }
  }

  async function deleteSwipe(messageIndex: number, swipeIndex: number) {
    if (!activeChat.value || messageIndex < 0 || messageIndex >= activeChat.value.messages.length) return;
    const message = activeChat.value.messages[messageIndex];

    if (!message || !Array.isArray(message.swipes) || message.swipes.length <= 1) {
      throw new Error('cannot_delete_last_swipe');
    }

    message.swipes.splice(swipeIndex, 1);
    if (Array.isArray(message.swipe_info)) {
      message.swipe_info.splice(swipeIndex, 1);
    }
    promptStore.clearItemizedPrompt(messageIndex, swipeIndex);

    const newSwipeId = Math.min(swipeIndex, message.swipes.length - 1);
    await eventEmitter.emit('message:swipe-deleted', { messageIndex, swipeIndex, newSwipeId });
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

    if (chatUiStore.activeMessageEditState) {
      if (chatUiStore.activeMessageEditState.index === index) {
        chatUiStore.activeMessageEditState.index = newIndex;
      } else if (chatUiStore.activeMessageEditState.index === newIndex) {
        chatUiStore.activeMessageEditState.index = index;
      }
    }
    triggerSave();
  }

  async function exportActiveChat(format: string) {
    if (!activeChat.value || !activeChatFile.value) {
      throw new Error(t('chatManagement.errors.noActiveChat'));
    }

    const { metadata, messages } = activeChat.value;

    if (messages.length === 0) {
      throw new Error(t('chatManagement.errors.noMessagesToExport'));
    }

    const fullChat: FullChat = [{ chat_metadata: metadata }, ...messages];
    await chatService.save(activeChatFile.value!, fullChat);

    const filename = metadata.name ? metadata.name.replace(/\\.jsonl?$/g, '') : activeChatFile.value!;
    const file = `${activeChatFile.value!}.jsonl`;
    const exportfilename = `${filename}.${format}`;

    const body: ChatExportRequest = {
      file,
      exportfilename,
      format,
    };

    const content = await chatService.export(body);

    const mimeType = format === 'txt' ? 'text/plain' : 'application/octet-stream';
    downloadFile(content, exportfilename, mimeType);
  }

  async function refreshChats() {
    const chats = await chatService.list();
    chats.sort((a, b) => b.last_mes.localeCompare(a.last_mes));
    chatInfos.value = chats;
  }

  async function importChats(file_type: 'jsonl' | 'json', file: File): Promise<{ fileNames: string[] }> {
    const result = await chatService.import(file_type, file);

    for (const fileName of result.fileNames) {
      try {
        const fileId = fileName.replace(/\.jsonl?$/, '');
        const fullChat = await chatService.fetch(fileId);
        if (fullChat.length === 0) {
          console.warn(`Imported chat ${fileName} is empty.`);
          continue;
        }
        const header = fullChat[0] as ChatHeader;
        const messages = fullChat.slice(1) as ChatMessage[];
        const lastMessage = messages[messages.length - 1];

        const chatInfo: ChatInfo = {
          file_id: fileId,
          file_name: fileName,
          file_size: formatFileSize(JSON.stringify(fullChat).length),
          chat_items: messages.length,
          mes: lastMessage?.mes.slice(0, 100) ?? '',
          last_mes: lastMessage ? lastMessage.send_date : getMessageTimeStamp(),
          chat_metadata: header.chat_metadata,
        };

        if (!chatInfos.value.find((c) => c.file_id === fileId)) {
          chatInfos.value.push(chatInfo);
        }
      } catch (e) {
        console.warn(`Failed to fetch imported chat ${fileName}:`, e);
      }
    }

    chatInfos.value.sort((a, b) => b.last_mes.localeCompare(a.last_mes));

    return result;
  }

  return {
    activeChat,
    chatInfos,
    activeMessageEditState: computed(() => chatUiStore.activeMessageEditState),
    isChatLoading: computed(() => chatUiStore.isChatLoading),
    isGenerating,
    activeChatFile,
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
    exportActiveChat,
    setActiveChatFile,
    createNewChatForCharacter,
    toggleChatPersona,
    syncPersonaName,
    updateChatName,
    syncSwipeToMes,
    triggerSave,
    deleteSelectedMessages,
    refreshChats,
    importChats,
  };
});
