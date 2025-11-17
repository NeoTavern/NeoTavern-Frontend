import { defineStore } from 'pinia';
import { nextTick, ref, watch } from 'vue';
import { GenerationMode, type ChatMessage, type ChatMetadata, type SwipeInfo } from '../types';
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
import {
  buildChatCompletionPayload,
  ChatCompletionService,
  type GenerationResponse,
  type StreamedChunk,
} from '../api/generation';
import { getThumbnailUrl } from '../utils/image';
import { default_user_avatar } from '../constants';
import { useSettingsStore } from './settings.store';
import { usePersonaStore } from './persona.store';
import { eventEmitter } from '../utils/event-emitter';

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
  const activeChatFile = ref<string | null>(null);
  const generationController = ref<AbortController | null>(null);

  const uiStore = useUiStore();
  const personaStore = usePersonaStore();

  watch(
    chat,
    () => {
      nextTick(() => {
        eventEmitter.emit('chat_changed');
      });
    },
    { deep: true },
  );

  function getCurrentChatId() {
    // TODO: Integrate group store later
    return activeChatFile.value;
  }

  async function saveChat() {
    if (uiStore.isChatSaving) {
      console.warn('Chat is already saving.');
      return;
    }

    const characterStore = useCharacterStore();
    const activeCharacter = characterStore.activeCharacter;
    if (!activeCharacter || !activeChatFile.value) {
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

      await apiSaveChat(activeCharacter, activeChatFile.value, chatToSave);
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
    activeChatFile.value = null;

    const promptStore = usePromptStore();
    promptStore.extensionPrompts = {};
    const currentChatId = getCurrentChatId();
    if (currentChatId) {
      await promptStore.saveItemizedPrompts(currentChatId);
    }
    promptStore.itemizedPrompts = [];
  }

  async function setActiveChatFile(chatFile: string) {
    if (activeChatFile.value === chatFile) return;
    await clearChat();
    activeChatFile.value = chatFile;
    await refreshChat();
  }

  async function refreshChat() {
    const characterStore = useCharacterStore();
    const activeCharacter = characterStore.activeCharacter;

    if (!activeCharacter || !activeChatFile.value) {
      console.error('refreshChat called with no active character or chat file');
      return;
    }

    // TODO: unshallow character logic if needed

    try {
      const response = await fetchChat(activeCharacter, activeChatFile.value);
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

      const currentChatId = getCurrentChatId();
      if (currentChatId) {
        const promptStore = usePromptStore();
        await promptStore.loadItemizedPrompts(currentChatId);
      }
      nextTick(() => {
        eventEmitter.emit('chat_entered', activeCharacter, activeChatFile.value);
      });
    } catch (error) {
      console.error('Failed to refresh chat:', error);
      toast.error(t('chat.loadError'));
    }
  }

  function abortGeneration() {
    if (generationController.value) {
      generationController.value.abort();
      isGenerating.value = false;
      generationController.value = null;
    }
  }

  async function generateResponse(mode: GenerationMode) {
    if (isGenerating.value) return;

    if (generationController.value) {
      generationController.value.abort();
    }
    generationController.value = new AbortController();

    const characterStore = useCharacterStore();
    const apiStore = useApiStore();
    const settingsStore = useSettingsStore();
    const activeCharacter = characterStore.activeCharacter;
    if (!activeCharacter) {
      console.error('generateResponse called without an active character.');
      return;
    }

    try {
      isGenerating.value = true;
      const genStarted = new Date().toISOString();
      let lastMessage = chat.value.length > 0 ? chat.value[chat.value.length - 1] : null;
      let chatHistoryForPrompt = [...chat.value];

      if (mode === GenerationMode.REGENERATE) {
        // If there's a last message and it's from the AI, remove it.
        // If the chat is empty or the last message is from the user, proceed as a "New" generation.
        if (lastMessage && !lastMessage.is_user) {
          chatHistoryForPrompt.pop(); // Use history before the last AI message
          chat.value.pop(); // Delete the message from display
          lastMessage = chat.value.length > 0 ? chat.value[chat.value.length - 1] : null;
        }
      } else if (mode === GenerationMode.ADD_SWIPE) {
        if (!lastMessage || lastMessage.is_user) return;
        chatHistoryForPrompt.pop(); // Use history before the message we're swiping
      } else if (mode === GenerationMode.CONTINUE) {
        if (!lastMessage || lastMessage.is_user) return;
      }

      if (!personaStore.activePersona) {
        toast.error(t('chat.generate.noPersonaError'));
        console.error('generateResponse called without an active persona.');
        return;
      }
      const promptBuilder = new PromptBuilder({
        character: activeCharacter,
        chatHistory: chatHistoryForPrompt,
        persona: personaStore.activePersona,
        samplerSettings: settingsStore.settings.api.samplers,
      });
      const messages = await promptBuilder.build();

      if (messages.length === 0) {
        throw new Error(t('chat.generate.noPrompts'));
      }

      const settings = settingsStore.settings;

      const activeModel = apiStore.activeModel;
      if (!activeModel) {
        toast.error(t('chat.generate.noModelError'));
        console.error('generateResponse called without an active model for the selected source.');
        return;
      }

      const payload = buildChatCompletionPayload({
        messages,
        model: activeModel,
        samplerSettings: settings.api.samplers,
        source: settings.api.chat_completion_source,
        providerSpecific: settings.api.provider_specific,
        playerName: uiStore.activePlayerName || 'User',
        characterName: activeCharacter.name,
        modelList: apiStore.modelList,
      });

      const handleGenerationResult = async (content: string, reasoning?: string) => {
        const genFinished = new Date().toISOString();
        const token_count = await getTokenCount(content);
        const swipeInfo: SwipeInfo = {
          send_date: getMessageTimeStamp(),
          gen_started: genStarted,
          gen_finished: genFinished,
          extra: { reasoning, token_count },
        };

        if (mode === GenerationMode.CONTINUE && lastMessage) {
          lastMessage.mes += content;
          lastMessage.gen_finished = genFinished;
          lastMessage.extra!.token_count = await getTokenCount(lastMessage.mes);
        } else if (mode === GenerationMode.ADD_SWIPE && lastMessage) {
          if (!Array.isArray(lastMessage.swipes)) lastMessage.swipes = [lastMessage.mes];
          if (!Array.isArray(lastMessage.swipe_info)) lastMessage.swipe_info = [];
          lastMessage.swipes.push(content);
          lastMessage.swipe_info.push(swipeInfo);
          syncSwipeToMes(chat.value.length - 1, lastMessage.swipes.length - 1);
        } else {
          // Handles NEW and REGENERATE
          const botMessage: ChatMessage = {
            name: activeCharacter.name,
            is_user: false,
            mes: content,
            send_date: swipeInfo.send_date,
            gen_started: genStarted,
            gen_finished: genFinished,
            swipes: [content],
            swipe_info: [swipeInfo],
            swipe_id: 0,
            extra: { reasoning, token_count },
          };
          chat.value.push(botMessage);
        }
        await saveChat();
      };

      if (!payload.stream) {
        const response = (await ChatCompletionService.generate(
          payload,
          generationController.value.signal,
        )) as GenerationResponse;
        await handleGenerationResult(response.content, response.reasoning);
      } else {
        // Streaming logic
        const streamGenerator = (await ChatCompletionService.generate(
          payload as any,
          generationController.value.signal,
        )) as unknown as () => AsyncGenerator<StreamedChunk>;

        let streamedContent = '';
        let streamedReasoning = '';
        let targetMessageIndex = -1;

        if (mode === GenerationMode.CONTINUE && lastMessage) {
          targetMessageIndex = chat.value.length - 1;
        } else if (mode === GenerationMode.ADD_SWIPE && lastMessage) {
          targetMessageIndex = chat.value.length - 1;
          if (!Array.isArray(lastMessage.swipes)) lastMessage.swipes = [lastMessage.mes];
          if (!Array.isArray(lastMessage.swipe_info)) lastMessage.swipe_info = [];
          lastMessage.swipe_id = lastMessage.swipes.length;
          lastMessage.swipes.push(''); // Add placeholder for new swipe
          lastMessage.mes = '';
          lastMessage.extra = { reasoning: '' };
        } else {
          // Handles NEW and REGENERATE
          const botMessage: ChatMessage = {
            name: activeCharacter.name,
            is_user: false,
            mes: '',
            send_date: getMessageTimeStamp(),
            gen_started: genStarted,
            swipes: [''],
            swipe_id: 0,
            swipe_info: [],
            extra: { reasoning: '' },
          };
          chat.value.push(botMessage);
          targetMessageIndex = chat.value.length - 1;
        }

        try {
          for await (const chunk of streamGenerator()) {
            streamedContent += chunk.delta;
            if (chunk.reasoning) streamedReasoning += chunk.reasoning;

            const targetMessage = chat.value[targetMessageIndex];
            if (mode === GenerationMode.ADD_SWIPE) {
              targetMessage.swipes![targetMessage.swipe_id!] += chunk.delta;
              targetMessage.mes = targetMessage.swipes![targetMessage.swipe_id!];
            } else {
              targetMessage.mes += chunk.delta;
            }
            if (chunk.reasoning) targetMessage.extra!.reasoning = streamedReasoning;
          }
        } finally {
          const finalMessage = chat.value[targetMessageIndex];
          if (!finalMessage) return; // Aborted before message was created
          finalMessage.gen_finished = new Date().toISOString();
          finalMessage.extra!.token_count = await getTokenCount(finalMessage.mes);

          if (mode === GenerationMode.NEW || mode === GenerationMode.REGENERATE) {
            finalMessage.swipes![0] = finalMessage.mes;
          }

          const swipeInfo: SwipeInfo = {
            send_date: finalMessage.send_date!,
            gen_started: genStarted,
            gen_finished: finalMessage.gen_finished,
            extra: { ...finalMessage.extra },
          };

          if (mode === GenerationMode.ADD_SWIPE) {
            if (!Array.isArray(finalMessage.swipe_info)) finalMessage.swipe_info = [];
            finalMessage.swipe_info.push(swipeInfo);
          } else if (mode === GenerationMode.NEW || mode === GenerationMode.REGENERATE) {
            finalMessage.swipe_info = [swipeInfo];
          }

          await saveChat();
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        toast.info('Generation aborted.');
      } else {
        console.error('Failed to generate response:', error);
        toast.error(error.message || t('chat.generate.errorFallback'));
      }
    } finally {
      isGenerating.value = false;
      generationController.value = null;
    }
  }

  async function sendMessage(messageText: string) {
    if (!messageText.trim() || isGenerating.value) {
      return;
    }

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

    await generateResponse(GenerationMode.NEW);
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

  async function saveMessageEdit(newContent: string, newReasoning?: string) {
    if (activeMessageEditIndex.value !== null) {
      const message = chat.value[activeMessageEditIndex.value];
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

    if (message.extra) {
      delete message.extra.display_text;
      delete message.extra.reasoning_display_text;
    }

    saveChat();
  }

  function swipeMessage(messageIndex: number, direction: 'left' | 'right') {
    const message = chat.value[messageIndex];
    if (!message || !Array.isArray(message.swipes)) return;

    let currentSwipeId = message.swipe_id ?? 0;
    const swipeCount = message.swipes.length;

    if (direction === 'left') {
      currentSwipeId = (currentSwipeId - 1 + swipeCount) % swipeCount;
      syncSwipeToMes(messageIndex, currentSwipeId);
    } else {
      // Right swipe
      if (currentSwipeId < swipeCount - 1) {
        currentSwipeId++;
        syncSwipeToMes(messageIndex, currentSwipeId);
      } else {
        generateResponse(GenerationMode.ADD_SWIPE);
      }
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
    activeChatFile,
    clearChat,
    refreshChat,
    saveChat,
    sendMessage,
    generateResponse,
    abortGeneration,
    startEditing,
    cancelEditing,
    saveMessageEdit,
    deleteMessage,
    deleteSwipe,
    swipeMessage,
    moveMessage,
    getCurrentChatId,
    setActiveChatFile,
  };
});
