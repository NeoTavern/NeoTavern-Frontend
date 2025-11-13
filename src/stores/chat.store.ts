import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ChatMessage } from '../types';
import { usePromptStore } from './prompt.store';
import { useCharacterStore } from './character.store';
import { useUiStore } from './ui.store';
import { useApiStore } from './api.store';
import { fetchChat, saveChat as apiSaveChat } from '../api/chat';
import { getMessageTimeStamp, humanizedDateTime } from '../utils/date';
import { uuidv4 } from '../utils/common';
import { getFirstMessage } from '../utils/chat';
import { toast } from '../composables/useToast';
import i18n from '../i18n';
import { PromptBuilder } from '../utils/prompt-builder';
import { ChatCompletionService } from '../api/generation';

export const useChatStore = defineStore('chat', () => {
  const { t } = i18n.global;
  const chat = ref<Array<ChatMessage>>([]);
  const chatMetadata = ref<Record<string, any>>({});
  const chatCreateDate = ref<string | null>(null);
  const activeMessageEditIndex = ref<number | null>(null);
  const chatSaveTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
  const saveMetadataTimeout = ref<ReturnType<typeof setTimeout> | null>(null);
  const isGenerating = ref(false);

  function getCurrentChatId() {
    // TODO: Integrate group store later
    const characterStore = useCharacterStore();
    return characterStore.activeCharacter?.chat;
  }

  async function saveChat() {
    const uiStore = useUiStore();
    if (uiStore.isChatSaving) {
      console.warn('Chat is already saving.');
      return;
    }

    const characterStore = useCharacterStore();
    const activeCharacter = characterStore.activeCharacter;
    if (!activeCharacter) {
      toast.error(t('chat.saveError'));
      return;
    }

    try {
      uiStore.isChatSaving = true;

      const chatToSave = [
        {
          user_name: uiStore.activePlayerName,
          character_name: activeCharacter.name,
          create_date: chatCreateDate.value,
          chat_metadata: chatMetadata.value,
        },
        ...chat.value,
      ];

      await apiSaveChat(activeCharacter, chatToSave);
      // TODO: Save token cache and itemized prompts
    } catch (error: any) {
      console.error('Failed to save chat:', error);
      toast.error(error.message || 'An unknown error occurred while saving the chat.');
    } finally {
      uiStore.isChatSaving = false;
    }
  }

  async function clearChat() {
    if (chatSaveTimeout.value) clearTimeout(chatSaveTimeout.value);
    if (saveMetadataTimeout.value) clearTimeout(saveMetadataTimeout.value);

    chat.value = [];
    chatMetadata.value = {};
    chatCreateDate.value = null;
    activeMessageEditIndex.value = null;
    chatSaveTimeout.value = null;
    saveMetadataTimeout.value = null;

    const promptStore = usePromptStore();
    promptStore.extensionPrompts = {};
    await promptStore.saveItemizedPrompts(getCurrentChatId());
    promptStore.itemizedPrompts = [];
  }

  async function refreshChat() {
    const characterStore = useCharacterStore();
    const activeCharacter = characterStore.activeCharacter;

    if (!activeCharacter) {
      console.error('refreshChat called with no active character');
      return;
    }

    // TODO: unshallow character logic if needed

    try {
      const response = await fetchChat(activeCharacter, chatMetadata.value);
      if (response.length > 0) {
        // Chat exists, load it
        const metadataItem = response.shift();
        chatCreateDate.value = metadataItem?.create_date ?? null;
        chatMetadata.value = metadataItem?.chat_metadata ?? {};
        chat.value = response;
      } else {
        // No chat exists, create a new one
        chatCreateDate.value = humanizedDateTime();
        chatMetadata.value = {};
        chat.value = [];

        const firstMessage = getFirstMessage(activeCharacter);
        if (firstMessage.mes) {
          chat.value.push(firstMessage);
          // Save the newly created chat to the server
          await saveChat();
        }
      }

      if (!chatMetadata.value['integrity']) {
        chatMetadata.value['integrity'] = uuidv4();
      }

      // TODO: getChatResult logic, which adds first message etc.

      const promptStore = usePromptStore();
      await promptStore.loadItemizedPrompts(getCurrentChatId());
    } catch (error) {
      console.error('Failed to refresh chat:', error);
      toast.error(t('chat.loadError'));
    }
  }

  async function generateResponse() {
    if (isGenerating.value) return;
    const characterStore = useCharacterStore();
    const apiStore = useApiStore();
    const activeCharacter = characterStore.activeCharacter;
    if (!activeCharacter) {
      console.error('generateResponse called without an active character.');
      return;
    }

    try {
      isGenerating.value = true;
      // TODO: Show typing indicator

      const promptBuilder = new PromptBuilder(activeCharacter, chat.value);
      const messages = promptBuilder.build();

      const payload = {
        messages,
        model: apiStore.oaiSettings.model_openai_select, // TODO: Make model selection dynamic, like per-provider
        chat_completion_source: apiStore.oaiSettings.chat_completion_source,
        max_tokens: apiStore.oaiSettings.openai_max_tokens,
        temperature: apiStore.oaiSettings.temp_openai,
        stream: false, //TODO: Support streaming
      };

      const response = await ChatCompletionService.generate(payload);

      const botMessage: ChatMessage = {
        name: activeCharacter.name,
        is_user: false,
        mes: response.content,
        send_date: getMessageTimeStamp(),
        extra: {}, // TODO: Add token counts, etc. here later
      };

      chat.value.push(botMessage);
      await saveChat();
    } catch (error: any) {
      console.error('Failed to generate response:', error);
      toast.error(error.message || 'Failed to get a response from the AI.');
    } finally {
      isGenerating.value = false;
      // TODO: Hide typing indicator
    }
  }

  async function sendMessage(messageText: string) {
    if (!messageText.trim() || isGenerating.value) {
      return;
    }

    const uiStore = useUiStore();
    const userMessage: ChatMessage = {
      name: uiStore.activePlayerName || 'User',
      is_user: true,
      mes: messageText.trim(),
      send_date: getMessageTimeStamp(),
      extra: {},
    };

    chat.value.push(userMessage);
    await saveChat();

    generateResponse();
  }

  return {
    chat,
    chatMetadata,
    chatCreateDate,
    activeMessageEditIndex,
    chatSaveTimeout,
    saveMetadataTimeout,
    isGenerating,
    clearChat,
    refreshChat,
    saveChat,
    sendMessage,
    generateResponse,
  };
});
