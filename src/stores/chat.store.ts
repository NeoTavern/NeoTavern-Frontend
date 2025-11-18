import { defineStore } from 'pinia';
import { nextTick, ref, watch } from 'vue';
import { debounce, type DebouncedFunc } from 'lodash-es';
import {
  type ChatMessage,
  type ChatMetadata,
  type SwipeInfo,
  type Character,
  type GenerationContext,
  type GenerationResponse,
  type StreamedChunk,
} from '../types';
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
import { buildChatCompletionPayload, ChatCompletionService } from '../api/generation';
import { getThumbnailUrl } from '../utils/image';
import { default_user_avatar, DEFAULT_SAVE_EDIT_TIMEOUT, GenerationMode } from '../constants';
import { useSettingsStore } from './settings.store';
import { usePersonaStore } from './persona.store';
import { eventEmitter } from '../utils/event-emitter';
import { ApiTokenizer } from '../api/tokenizer';

export const useChatStore = defineStore('chat', () => {
  const { t } = useStrictI18n();
  const chat = ref<Array<ChatMessage>>([]);
  const chatMetadata = ref<ChatMetadata>({});
  const chatCreateDate = ref<string | null>(null);
  const activeMessageEditIndex = ref<number | null>(null);
  const originalMessageContent = ref<string | null>(null);
  const isGenerating = ref(false);
  const activeChatFile = ref<string | null>(null);
  const generationController = ref<AbortController | null>(null);
  const isChatLoading = ref(false); // Prevents watcher from saving during initialization

  const uiStore = useUiStore();
  const personaStore = usePersonaStore();

  const saveChatDebounced: DebouncedFunc<() => Promise<void>> = debounce(async () => {
    const characterStore = useCharacterStore();
    const activeCharacter = characterStore.activeCharacter;
    if (!activeCharacter || !activeChatFile.value) {
      console.error('Debounced save failed: No active character or chat file.');
      return;
    }

    try {
      uiStore.isChatSaving = true;
      const chatToSave = [
        {
          character_name: activeCharacter.name,
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
  }, DEFAULT_SAVE_EDIT_TIMEOUT);

  watch(
    [chat, chatMetadata],
    () => {
      // Emit event for UI reactivity
      nextTick(async () => {
        await eventEmitter.emit('chat:updated');
      });

      // Trigger debounced save if not loading
      if (!isChatLoading.value && activeChatFile.value) {
        saveChatDebounced();
      }
    },
    { deep: true },
  );

  function getCurrentChatId() {
    // TODO: Integrate group store later
    return activeChatFile.value;
  }

  async function clearChat(recreateFirstMessage = false) {
    isChatLoading.value = true;

    saveChatDebounced.cancel();
    chat.value = [];
    chatMetadata.value = {};
    chatCreateDate.value = null;
    activeMessageEditIndex.value = null;

    if (!recreateFirstMessage) {
      activeChatFile.value = null;
    }

    const promptStore = usePromptStore();
    promptStore.extensionPrompts = {};
    const currentChatId = getCurrentChatId();
    if (currentChatId) {
      await promptStore.saveItemizedPrompts(currentChatId);
    }
    promptStore.itemizedPrompts = [];
    await eventEmitter.emit('chat:cleared');

    if (recreateFirstMessage) {
      const characterStore = useCharacterStore();
      const activeCharacter = characterStore.activeCharacter;
      if (activeCharacter) {
        const firstMessage = getFirstMessage(activeCharacter);
        if (firstMessage.mes) {
          chat.value.push(firstMessage);
          await eventEmitter.emit('message:created', firstMessage);
        }
      }
    }

    isChatLoading.value = false;

    // Manually trigger a save if a new first message was created.
    if (recreateFirstMessage && chat.value.length > 0) {
      saveChatDebounced();
    }
  }

  async function setActiveChatFile(chatFile: string) {
    if (activeChatFile.value === chatFile) return;
    await clearChat(false);
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
    isChatLoading.value = true;
    let wasNewChatCreated = false;

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
        wasNewChatCreated = true;
        chatCreateDate.value = humanizedDateTime();
        chatMetadata.value = {};
        chat.value = [];

        const firstMessage = getFirstMessage(activeCharacter);
        if (firstMessage.mes) {
          chat.value.push(firstMessage);
          await eventEmitter.emit('message:created', firstMessage);
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
      nextTick(async () => {
        await eventEmitter.emit('chat:entered', activeCharacter as Character, activeChatFile.value as string);
      });
    } catch (error) {
      console.error('Failed to refresh chat:', error);
      toast.error(t('chat.loadError'));
    } finally {
      isChatLoading.value = false;
      if (wasNewChatCreated) {
        saveChatDebounced();
      }
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

    const startController = new AbortController();
    await eventEmitter.emit('generation:started', startController);
    if (startController.signal.aborted) {
      console.log(`Generation aborted by extension (generation:started). Reason: ${startController.signal.reason}`);
      return;
    }

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

    let generatedMessage: ChatMessage | null = null;
    let generationError: Error | undefined;

    try {
      isGenerating.value = true;
      const genStarted = new Date().toISOString();
      let lastMessage = chat.value.length > 0 ? chat.value[chat.value.length - 1] : null;
      let chatHistoryForPrompt = [...chat.value];

      if (mode === GenerationMode.REGENERATE) {
        if (lastMessage && !lastMessage.is_user) {
          chatHistoryForPrompt.pop();
          chat.value.pop();
          lastMessage = chat.value.length > 0 ? chat.value[chat.value.length - 1] : null;
        }
      } else if (mode === GenerationMode.ADD_SWIPE) {
        if (!lastMessage || lastMessage.is_user) return;
        chatHistoryForPrompt.pop();
      } else if (mode === GenerationMode.CONTINUE) {
        if (!lastMessage || lastMessage.is_user) return;
      }

      const activePersona = personaStore.activePersona;
      if (!activePersona) {
        throw new Error(t('chat.generate.noPersonaError'));
      }

      const settings = settingsStore.settings;
      const activeModel = apiStore.activeModel;
      if (!activeModel) {
        throw new Error(t('chat.generate.noModelError'));
      }

      const tokenizer = new ApiTokenizer({ tokenizerType: settings.api.tokenizer, model: activeModel });

      const context: GenerationContext = {
        mode,
        character: activeCharacter,
        history: chatHistoryForPrompt,
        persona: activePersona,
        settings: {
          sampler: settings.api.samplers,
          source: settings.api.chat_completion_source,
          model: activeModel,
          providerSpecific: settings.api.provider_specific,
        },
        playerName: uiStore.activePlayerName || 'User',
        characterName: activeCharacter.name,
        controller: new AbortController(),
        tokenizer: tokenizer,
      };

      await eventEmitter.emit('process:generation-context', context);
      if (context.controller.signal.aborted) {
        console.log(
          `Generation aborted by extension (process:generation-context). Reason: ${context.controller.signal.reason}`,
        );
        return;
      }

      const promptBuilder = new PromptBuilder({
        character: context.character,
        chatHistory: context.history,
        persona: context.persona,
        samplerSettings: context.settings.sampler,
        tokenizer: context.tokenizer,
      });
      const messages = await promptBuilder.build();

      if (messages.length === 0) {
        throw new Error(t('chat.generate.noPrompts'));
      }

      const payload = buildChatCompletionPayload({
        messages,
        model: context.settings.model,
        samplerSettings: context.settings.sampler,
        source: context.settings.source,
        providerSpecific: context.settings.providerSpecific,
        playerName: context.playerName,
        characterName: context.characterName,
        modelList: apiStore.modelList,
      });

      const payloadController = new AbortController();
      await eventEmitter.emit('process:request-payload', payload, payloadController);
      if (payloadController.signal.aborted) {
        console.log(
          `Generation aborted by extension (process:request-payload). Reason: ${payloadController.signal.reason}`,
        );
        return;
      }

      const handleGenerationResult = async (content: string, reasoning?: string) => {
        const genFinished = new Date().toISOString();
        const token_count = await tokenizer.getTokenCount(content);
        const swipeInfo: SwipeInfo = {
          send_date: getMessageTimeStamp(),
          gen_started: genStarted,
          gen_finished: genFinished,
          extra: { reasoning, token_count },
        };

        if (mode === GenerationMode.CONTINUE && lastMessage) {
          lastMessage.mes += content;
          lastMessage.gen_finished = genFinished;
          lastMessage.extra!.token_count = await tokenizer.getTokenCount(lastMessage.mes);
          generatedMessage = lastMessage;
          await eventEmitter.emit('message:updated', chat.value.length - 1, lastMessage);
        } else if (mode === GenerationMode.ADD_SWIPE && lastMessage) {
          if (!Array.isArray(lastMessage.swipes)) lastMessage.swipes = [lastMessage.mes];
          if (!Array.isArray(lastMessage.swipe_info)) lastMessage.swipe_info = [];
          lastMessage.swipes.push(content);
          lastMessage.swipe_info.push(swipeInfo);
          await syncSwipeToMes(chat.value.length - 1, lastMessage.swipes.length - 1);
          generatedMessage = lastMessage;
        } else {
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

          const createController = new AbortController();
          await eventEmitter.emit('generation:before-message-create', botMessage, createController);
          if (createController.signal.aborted) {
            console.log(
              `Generation aborted by extension (generation:before-message-create). Reason: ${createController.signal.reason}`,
            );
            return;
          }

          chat.value.push(botMessage);
          generatedMessage = botMessage;
          await eventEmitter.emit('message:created', botMessage);
        }
      };

      if (!payload.stream) {
        const response = (await ChatCompletionService.generate(
          payload,
          generationController.value.signal,
        )) as GenerationResponse;

        const responseController = new AbortController();
        await eventEmitter.emit('process:response', response, payload, responseController);
        if (responseController.signal.aborted) {
          console.log(
            `Generation aborted by extension (process:response). Reason: ${responseController.signal.reason}`,
          );
          return;
        }

        await handleGenerationResult(response.content, response.reasoning);
      } else {
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
          lastMessage.swipes.push('');
          lastMessage.mes = '';
          lastMessage.extra = { reasoning: '' };
        } else {
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

          const createController = new AbortController();
          await eventEmitter.emit('generation:before-message-create', botMessage, createController);
          if (createController.signal.aborted) {
            console.log(
              `Generation aborted by extension (generation:before-message-create). Reason: ${createController.signal.reason}`,
            );
            return;
          }

          chat.value.push(botMessage);
          generatedMessage = botMessage;
          targetMessageIndex = chat.value.length - 1;
          await eventEmitter.emit('message:created', botMessage);
        }

        try {
          for await (const chunk of streamGenerator()) {
            const chunkController = new AbortController();
            await eventEmitter.emit('process:stream-chunk', chunk, payload, chunkController);
            if (chunkController.signal.aborted) {
              console.log(
                `Generation aborted by extension (process:stream-chunk). Reason: ${chunkController.signal.reason}`,
              );
              generationController.value?.abort();
              break;
            }
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
          if (!finalMessage) return;
          finalMessage.gen_finished = new Date().toISOString();
          finalMessage.extra!.token_count = await tokenizer.getTokenCount(finalMessage.mes);

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
        }
      }
    } catch (error: any) {
      generationError = error;
      if (error.name === 'AbortError') {
        toast.info('Generation aborted.');
      } else {
        console.error('Failed to generate response:', error);
        toast.error(error.message || t('chat.generate.errorFallback'));
      }
    } finally {
      isGenerating.value = false;
      generationController.value = null;
      await eventEmitter.emit('generation:finished', generatedMessage, generationError);
    }
  }

  async function sendMessage(messageText: string, triggerGeneration = true) {
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

    const createController = new AbortController();
    await eventEmitter.emit('chat:before-message-create', userMessage, createController);
    if (createController.signal.aborted) {
      console.log(
        `Message creation aborted by extension (chat:before-message-create). Reason: ${createController.signal.reason}`,
      );
      return;
    }
    chat.value.push(userMessage);
    await eventEmitter.emit('message:created', userMessage);

    if (triggerGeneration) {
      await generateResponse(GenerationMode.NEW);
    }
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
      const index = activeMessageEditIndex.value;
      const message = chat.value[index];
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
      await eventEmitter.emit('message:updated', index, message);
    }
  }

  async function updateMessageObject(index: number, updates: Partial<ChatMessage>): Promise<void> {
    if (index < 0 || index >= chat.value.length) {
      console.warn(`[ChatStore] updateMessageObject: index ${index} out of bounds.`);
      return;
    }
    const message = chat.value[index];
    Object.assign(message, updates);

    if (updates.mes !== undefined) {
      if (message.swipes && typeof message.swipe_id === 'number' && message.swipes[message.swipe_id] !== undefined) {
        message.swipes[message.swipe_id] = updates.mes;
      }
    }

    await eventEmitter.emit('message:updated', index, message);
  }

  async function syncSwipeToMes(messageIndex: number, swipeIndex: number) {
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
    await eventEmitter.emit('message:updated', messageIndex, message);
  }

  async function swipeMessage(messageIndex: number, direction: 'left' | 'right') {
    const message = chat.value[messageIndex];
    if (!message || !Array.isArray(message.swipes)) return;

    let currentSwipeId = message.swipe_id ?? 0;
    const swipeCount = message.swipes.length;

    if (direction === 'left') {
      currentSwipeId = (currentSwipeId - 1 + swipeCount) % swipeCount;
      await syncSwipeToMes(messageIndex, currentSwipeId);
    } else {
      // Right swipe
      if (currentSwipeId < swipeCount - 1) {
        currentSwipeId++;
        await syncSwipeToMes(messageIndex, currentSwipeId);
      } else {
        await generateResponse(GenerationMode.ADD_SWIPE);
      }
    }
  }

  async function deleteMessage(index: number) {
    if (index < 0 || index >= chat.value.length) return;
    chat.value.splice(index, 1);
    if (activeMessageEditIndex.value === index) {
      cancelEditing();
    }
    await eventEmitter.emit('message:deleted', index);
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

    const newSwipeId = Math.min(swipeIndex, message.swipes.length - 1);
    await syncSwipeToMes(messageIndex, newSwipeId);
  }

  function moveMessage(index: number, direction: 'up' | 'down') {
    if (index < 0 || index >= chat.value.length) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= chat.value.length) return;

    [chat.value[index], chat.value[newIndex]] = [chat.value[newIndex], chat.value[index]];

    if (activeMessageEditIndex.value === index) {
      activeMessageEditIndex.value = newIndex;
    } else if (activeMessageEditIndex.value === newIndex) {
      activeMessageEditIndex.value = index;
    }
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
    getCurrentChatId,
    setActiveChatFile,
  };
});
