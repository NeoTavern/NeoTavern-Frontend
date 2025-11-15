import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ChatMessage, ChatMetadata } from '../types';
import { usePromptStore } from './prompt.store';
import { useCharacterStore } from './character.store';
import { useUiStore } from './ui.store';
import { useApiStore } from './api.store';
import { fetchChat, saveChat as apiSaveChat } from '../api/chat';
import { getMessageTimeStamp, humanizedDateTime } from '../utils/date';
import { uuidv4 } from '../utils/common';
import { getFirstMessage } from '../utils/chat';
import { toast } from '../composables/useToast';
import { useStrictI18n } from '../composables/useStrictI18n';
import { PromptBuilder } from '../utils/prompt-builder';
import { ChatCompletionService, type GenerationResponse, type StreamedChunk } from '../api/generation';
import { getThumbnailUrl } from '../utils/image';
import { default_user_avatar } from '../constants';

// TODO: Replace with a real API call to the backend for accurate tokenization
async function getTokenCount(text: string): Promise<number> {
  if (!text || typeof text !== 'string') return 0;
  // This is a very rough approximation. The backend will have a proper tokenizer.
  return Math.round(text.length / 4);
}

export const useChatStore = defineStore('chat', () => {
  const { t } = useStrictI18n();
  const chat = ref<Array<ChatMessage>>([]);
  const chatMetadata = ref<ChatMetadata>({});
  const chatCreateDate = ref<string | null>(null);
  const activeMessageEditIndex = ref<number | null>(null);
  const originalMessageContent = ref<string | null>(null);
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
      const genStarted = new Date().toISOString();
      // TODO: Show typing indicator

      const promptBuilder = new PromptBuilder(activeCharacter, chat.value);
      const messages = await promptBuilder.build();
      if (messages.length === 0) {
        throw new Error(t('chat.generate.noPrompts'));
      }

      const payload = {
        messages,
        model: apiStore.activeModel,
        chat_completion_source: apiStore.oaiSettings.chat_completion_source,
        max_tokens: apiStore.oaiSettings.openai_max_tokens,
        temperature: apiStore.oaiSettings.temp_openai,
        stream: apiStore.oaiSettings.stream_openai ?? true,
      };

      if (!payload.stream) {
        const response = (await ChatCompletionService.generate(payload)) as GenerationResponse;
        const genFinished = new Date().toISOString();
        const token_count = await getTokenCount(response.content);

        const botMessage: ChatMessage = {
          name: activeCharacter.name,
          is_user: false,
          mes: response.content,
          send_date: getMessageTimeStamp(),
          gen_started: genStarted,
          gen_finished: genFinished,
          extra: {
            reasoning: response.reasoning,
            token_count: token_count,
          },
        };

        chat.value.push(botMessage);
        await saveChat();
      } else {
        // Streaming logic
        const streamGenerator = (await ChatCompletionService.generate(
          payload as any,
        )) as unknown as () => AsyncGenerator<StreamedChunk>;

        const botMessage: ChatMessage = {
          name: activeCharacter.name,
          is_user: false,
          mes: '',
          send_date: getMessageTimeStamp(),
          gen_started: genStarted,
          extra: { reasoning: '' },
        };
        chat.value.push(botMessage);
        const messageIndex = chat.value.length - 1;

        try {
          for await (const chunk of streamGenerator()) {
            chat.value[messageIndex].mes += chunk.delta;
            if (chunk.reasoning) {
              chat.value[messageIndex].extra!.reasoning = chunk.reasoning;
            }
          }
        } finally {
          const finalMessage = chat.value[messageIndex];
          finalMessage.gen_finished = new Date().toISOString();
          finalMessage.extra!.token_count = await getTokenCount(finalMessage.mes);
          await saveChat();
        }
      }
    } catch (error: any) {
      console.error('Failed to generate response:', error);
      toast.error(error.message || t('chat.generate.errorFallback'));
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
      force_avatar: getThumbnailUrl('persona', uiStore.activePlayerAvatar || default_user_avatar),
      extra: {},
    };

    chat.value.push(userMessage);
    await saveChat();

    await generateResponse();
  }

  function startEditing(index: number) {
    if (index >= 0 && index < chat.value.length) {
      originalMessageContent.value = chat.value[index].mes;
      activeMessageEditIndex.value = index;
    }
  }

  function cancelEditing() {
    activeMessageEditIndex.value = null;
    originalMessageContent.value = null;
  }

  async function saveMessageEdit(newContent: string) {
    if (activeMessageEditIndex.value !== null) {
      chat.value[activeMessageEditIndex.value].mes = newContent;
      await saveChat();
      cancelEditing();
    }
  }

  function syncSwipeToMes(messageIndex: number, swipeIndex: number) {
    if (messageIndex < 0 || messageIndex >= chat.value.length) return;

    const message = chat.value[messageIndex];
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
  }

  async function deleteMessage(index: number) {
    if (index < 0 || index >= chat.value.length) return;
    chat.value.splice(index, 1);
    if (activeMessageEditIndex.value === index) {
      cancelEditing();
    }
    await saveChat();
  }

  async function deleteSwipe(messageIndex: number, swipeIndex: number) {
    const message = chat.value[messageIndex];
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

    // Select the next swipe, or the one before if it was the last one
    const newSwipeId = Math.min(swipeIndex, message.swipes.length - 1);
    syncSwipeToMes(messageIndex, newSwipeId);

    // After syncing, the component will re-render with the new swipe content.
    // The message object itself persists, only its content changes.
    await saveChat();
  }

  async function moveMessage(index: number, direction: 'up' | 'down') {
    if (index < 0 || index >= chat.value.length) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= chat.value.length) return;

    // Swap elements
    [chat.value[index], chat.value[newIndex]] = [chat.value[newIndex], chat.value[index]];

    // If we moved the message that was being edited, update its index
    if (activeMessageEditIndex.value === index) {
      activeMessageEditIndex.value = newIndex;
    } else if (activeMessageEditIndex.value === newIndex) {
      activeMessageEditIndex.value = index;
    }

    await saveChat();
  }

  return {
    chat,
    chatMetadata,
    chatCreateDate,
    activeMessageEditIndex,
    isGenerating,
    clearChat,
    refreshChat,
    saveChat,
    sendMessage,
    generateResponse,
    startEditing,
    cancelEditing,
    saveMessageEdit,
    deleteMessage,
    deleteSwipe,
    moveMessage,
    getCurrentChatId,
  };
});
