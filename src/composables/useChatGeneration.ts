import { ref, nextTick, type Ref, type ComputedRef } from 'vue';
import {
  type ChatMessage,
  type GenerationContext,
  type GenerationResponse,
  type StreamedChunk,
  type ItemizedPrompt,
  type PromptTokenBreakdown,
  type SwipeInfo,
  type Character,
  type WorldInfoBook,
  type ChatMetadata,
} from '../types';
import { GenerationMode, GroupGenerationHandlingMode, default_user_avatar } from '../constants';
import { eventEmitter } from '../utils/event-emitter';
import { PromptBuilder } from '../utils/prompt-builder';
import { buildChatCompletionPayload, ChatCompletionService } from '../api/generation';
import { ApiTokenizer } from '../api/tokenizer';
import { getCharactersForContext } from '../utils/group-chat';
import { getMessageTimeStamp } from '../utils/date';
import { getThumbnailUrl } from '../utils/image';
import { toast } from './useToast';
import { determineNextSpeaker } from '../utils/group-chat-logic';

// Stores
import { useCharacterStore } from '../stores/character.store';
import { useApiStore } from '../stores/api.store';
import { useSettingsStore } from '../stores/settings.store';
import { usePromptStore } from '../stores/prompt.store';
import { usePersonaStore } from '../stores/persona.store';
import { useWorldInfoStore } from '../stores/world-info.store';
import { useUiStore } from '../stores/ui.store';
import { useStrictI18n } from './useStrictI18n';

export interface ChatStateRef {
  messages: ChatMessage[];
  metadata: ChatMetadata;
}

export interface ChatGenerationDependencies {
  activeChat: Ref<ChatStateRef | null>;
  groupConfig: ComputedRef<ChatMetadata['group'] | null>;
  syncSwipeToMes: (msgIndex: number, swipeIndex: number) => Promise<void>;
  stopAutoModeTimer: () => void;
}

export function useChatGeneration(deps: ChatGenerationDependencies) {
  const { t } = useStrictI18n();
  const isGenerating = ref(false);
  const generationController = ref<AbortController | null>(null);

  const characterStore = useCharacterStore();
  const apiStore = useApiStore();
  const settingsStore = useSettingsStore();
  const promptStore = usePromptStore();
  const personaStore = usePersonaStore();
  const worldInfoStore = useWorldInfoStore();
  const uiStore = useUiStore();

  function abortGeneration() {
    if (generationController.value) {
      generationController.value.abort();
      isGenerating.value = false;
      generationController.value = null;
    }
  }

  async function sendMessage(messageText: string, triggerGeneration = true) {
    if (!messageText.trim() || isGenerating.value || deps.activeChat.value === null || !personaStore.activePersona) {
      return;
    }

    deps.stopAutoModeTimer();

    const userMessage: ChatMessage = {
      name: uiStore.activePlayerName || 'User',
      is_user: true,
      mes: messageText.trim(),
      send_date: getMessageTimeStamp(),
      force_avatar: getThumbnailUrl('persona', uiStore.activePlayerAvatar || default_user_avatar),
      original_avatar: personaStore.activePersona.avatarId,
      is_system: false,
      extra: {},
      swipe_id: 0,
      swipes: [messageText.trim()],
      swipe_info: [
        {
          send_date: getMessageTimeStamp(),
          extra: {},
        },
      ],
    };

    const createController = new AbortController();
    await eventEmitter.emit('chat:before-message-create', userMessage, createController);
    if (createController.signal.aborted) {
      console.log(`Message creation aborted by extension. Reason: ${createController.signal.reason}`);
      return;
    }

    deps.activeChat.value.messages.push(userMessage);
    await nextTick();
    await eventEmitter.emit('message:created', userMessage);

    if (triggerGeneration) {
      await generateResponse(GenerationMode.NEW);
    }
  }

  async function generateResponse(mode: GenerationMode, forceSpeakerAvatar?: string) {
    if (isGenerating.value) return;

    if (!deps.activeChat.value) {
      console.error('Attempted to generate response without an active chat.');
      return;
    }

    const startController = new AbortController();
    await eventEmitter.emit('generation:started', startController);
    if (startController.signal.aborted) {
      return;
    }

    if (generationController.value) {
      generationController.value.abort();
    }
    generationController.value = new AbortController();

    let activeCharacter: Character | null = null;

    if (forceSpeakerAvatar) {
      activeCharacter = characterStore.activeCharacters.find((c) => c.avatar === forceSpeakerAvatar) || null;
    }

    if (!activeCharacter) {
      if (characterStore.activeCharacters.length === 1) {
        activeCharacter = characterStore.activeCharacters[0];
      } else {
        // Use utility for next speaker
        activeCharacter = determineNextSpeaker(
          characterStore.activeCharacters,
          deps.groupConfig.value,
          deps.activeChat.value.messages,
        );
      }
    }

    if (!activeCharacter) {
      toast.info(t('chat.generate.noSpeaker'));
      isGenerating.value = false;
      return;
    }

    let generatedMessage: ChatMessage | null = null;
    let generationError: Error | undefined;

    const activeChatMessages = deps.activeChat.value.messages;

    try {
      isGenerating.value = true;
      const genStarted = new Date().toISOString();
      let lastMessage = activeChatMessages.length > 0 ? activeChatMessages[activeChatMessages.length - 1] : null;
      const chatHistoryForPrompt = [...activeChatMessages];

      if (mode === GenerationMode.REGENERATE) {
        if (lastMessage && !lastMessage.is_user) {
          chatHistoryForPrompt.pop();
          activeChatMessages.pop();
          lastMessage = activeChatMessages.length > 0 ? activeChatMessages[activeChatMessages.length - 1] : null;
        }
      } else if (mode === GenerationMode.ADD_SWIPE) {
        if (!lastMessage || lastMessage.is_user) return; // Can't swipe a user message or empty chat
        chatHistoryForPrompt.pop();
      } else if (mode === GenerationMode.CONTINUE) {
        if (!lastMessage || lastMessage.is_user) return;
      }

      const activePersona = personaStore.activePersona;
      if (!activePersona) throw new Error(t('chat.generate.noPersonaError'));

      const settings = settingsStore.settings;
      const activeModel = apiStore.activeModel;
      if (!activeModel) throw new Error(t('chat.generate.noModelError'));

      const tokenizer = new ApiTokenizer({ tokenizerType: settings.api.tokenizer, model: activeModel });
      const handlingMode = deps.groupConfig.value?.config.handlingMode ?? GroupGenerationHandlingMode.SWAP;

      const mutedMap: Record<string, boolean> = {};
      if (deps.groupConfig.value?.members) {
        for (const [key, val] of Object.entries(deps.groupConfig.value.members)) {
          mutedMap[key] = val.muted;
        }
      }

      const charactersForContext = getCharactersForContext(
        characterStore.activeCharacters,
        activeCharacter,
        handlingMode !== GroupGenerationHandlingMode.SWAP,
        handlingMode === GroupGenerationHandlingMode.JOIN_INCLUDE_MUTED,
        mutedMap,
      );

      const context: GenerationContext = {
        mode,
        characters: charactersForContext,
        chatMetadata: deps.activeChat.value.metadata,
        history: chatHistoryForPrompt,
        persona: activePersona,
        settings: {
          sampler: settings.api.samplers,
          source: settings.api.chatCompletionSource,
          model: activeModel,
          providerSpecific: settings.api.providerSpecific,
        },
        playerName: uiStore.activePlayerName || 'User',
        controller: new AbortController(),
        tokenizer: tokenizer,
      };

      await eventEmitter.emit('process:generation-context', context);
      if (context.controller.signal.aborted) return;

      const promptBuilder = new PromptBuilder({
        characters: context.characters,
        chatMetadata: context.chatMetadata,
        chatHistory: context.history,
        persona: context.persona,
        samplerSettings: context.settings.sampler,
        tokenizer: context.tokenizer,
        books: (
          await Promise.all(
            worldInfoStore.activeBookNames.map(async (name) => await worldInfoStore.getBookFromCache(name, true)),
          )
        ).filter((book): book is WorldInfoBook => book !== undefined),
        worldInfo: settingsStore.settings.worldInfo,
      });

      const messages = await promptBuilder.build();
      if (messages.length === 0) throw new Error(t('chat.generate.noPrompts'));

      const promptTotal = await Promise.all(messages.map((m) => tokenizer.getTokenCount(m.content))).then((counts) =>
        counts.reduce((a, b) => a + b, 0),
      );

      const processedWorldInfo = promptBuilder.processedWorldInfo;
      let wiTokens = 0;
      if (processedWorldInfo) {
        const parts = [
          processedWorldInfo.worldInfoBefore,
          processedWorldInfo.worldInfoAfter,
          ...processedWorldInfo.anBefore,
          ...processedWorldInfo.anAfter,
          ...processedWorldInfo.emBefore,
          ...processedWorldInfo.emAfter,
          ...processedWorldInfo.depthEntries.flatMap((d) => d.entries),
          ...Object.values(processedWorldInfo.outletEntries).flat(),
        ];
        const fullWiText = parts.filter(Boolean).join('\n');
        if (fullWiText) wiTokens = await tokenizer.getTokenCount(fullWiText);
      }

      const charDesc = await tokenizer.getTokenCount(activeCharacter.description || '');
      const charPers = await tokenizer.getTokenCount(activeCharacter.personality || '');
      const charScen = await tokenizer.getTokenCount(activeCharacter.scenario || '');
      const charEx = await tokenizer.getTokenCount(activeCharacter.mes_example || '');
      const personaDesc = await tokenizer.getTokenCount(activePersona.description || '');

      const breakdown: PromptTokenBreakdown = {
        systemTotal: 0,
        description: charDesc,
        personality: charPers,
        scenario: charScen,
        examples: charEx,
        persona: personaDesc,
        worldInfo: wiTokens,
        chatHistory: 0,
        extensions: 0,
        bias: 0,
        promptTotal: promptTotal,
        maxContext: context.settings.sampler.max_context,
        padding: context.settings.sampler.max_context - promptTotal - context.settings.sampler.max_tokens,
      };

      for (const m of messages) {
        const count = await tokenizer.getTokenCount(m.content);
        if (m.role === 'system') breakdown.systemTotal += count;
        else breakdown.chatHistory += count;
      }

      const itemizedPrompt: ItemizedPrompt = {
        messageIndex: mode === GenerationMode.CONTINUE ? activeChatMessages.length - 1 : activeChatMessages.length,
        model: context.settings.model,
        api: context.settings.source,
        tokenizer: settings.api.tokenizer,
        presetName: settings.api.selectedSampler || 'Default',
        messages: messages,
        breakdown: breakdown,
        timestamp: Date.now(),
        worldInfoEntries: processedWorldInfo?.triggeredEntries ?? {},
      };
      promptStore.addItemizedPrompt(itemizedPrompt);

      const payload = buildChatCompletionPayload({
        messages,
        model: context.settings.model,
        samplerSettings: context.settings.sampler,
        source: context.settings.source,
        providerSpecific: context.settings.providerSpecific,
        playerName: context.playerName,
        modelList: apiStore.modelList,
      });

      const payloadController = new AbortController();
      await eventEmitter.emit('process:request-payload', payload, payloadController);
      if (payloadController.signal.aborted) return;

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
          if (!lastMessage.extra) lastMessage.extra = {};
          lastMessage.extra.token_count = await tokenizer.getTokenCount(lastMessage.mes);

          if (lastMessage.swipes && lastMessage.swipe_id !== undefined && lastMessage.swipes[lastMessage.swipe_id] !== undefined) {
            lastMessage.swipes[lastMessage.swipe_id] = lastMessage.mes;
          }

          generatedMessage = lastMessage;
          await nextTick();
          await eventEmitter.emit('message:updated', activeChatMessages.length - 1, lastMessage);
        } else if (mode === GenerationMode.ADD_SWIPE && lastMessage) {
          if (!Array.isArray(lastMessage.swipes)) lastMessage.swipes = [lastMessage.mes];
          if (!Array.isArray(lastMessage.swipe_info)) lastMessage.swipe_info = [];
          lastMessage.swipes.push(content);
          lastMessage.swipe_info.push(swipeInfo);
          await deps.syncSwipeToMes(activeChatMessages.length - 1, lastMessage.swipes.length - 1);
          generatedMessage = lastMessage;
        } else {
          // New Message (NEW or REGENERATE)
          const botMessage: ChatMessage = {
            name: activeCharacter!.name,
            is_user: false,
            mes: content,
            send_date: swipeInfo.send_date,
            gen_started: genStarted,
            gen_finished: genFinished,
            is_system: false,
            swipes: [content],
            swipe_info: [swipeInfo],
            swipe_id: 0,
            extra: { reasoning, token_count },
            original_avatar: activeCharacter!.avatar,
          };

          const createController = new AbortController();
          await eventEmitter.emit('generation:before-message-create', botMessage, createController);
          if (createController.signal.aborted) return;

          activeChatMessages.push(botMessage);
          generatedMessage = botMessage;
          await nextTick();
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
        if (responseController.signal.aborted) return;

        await handleGenerationResult(response.content, response.reasoning);
      } else {
        const streamGenerator = (await ChatCompletionService.generate(
          payload,
          generationController.value.signal,
        )) as unknown as () => AsyncGenerator<StreamedChunk>;

        let streamedReasoning = '';
        let targetMessageIndex = -1;

        if (mode === GenerationMode.NEW || mode === GenerationMode.REGENERATE) {
          const botMessage: ChatMessage = {
            name: activeCharacter!.name,
            is_user: false,
            mes: '',
            send_date: getMessageTimeStamp(),
            gen_started: genStarted,
            is_system: false,
            swipes: [''],
            swipe_id: 0,
            swipe_info: [],
            extra: { reasoning: '' },
            original_avatar: activeCharacter!.avatar,
          };

          const createController = new AbortController();
          await eventEmitter.emit('generation:before-message-create', botMessage, createController);
          if (createController.signal.aborted) return;

          activeChatMessages.push(botMessage);
          generatedMessage = botMessage;
          targetMessageIndex = activeChatMessages.length - 1;
          await nextTick();
          await eventEmitter.emit('message:created', botMessage);
        } else if (mode === GenerationMode.ADD_SWIPE && lastMessage) {
          targetMessageIndex = activeChatMessages.length - 1;
          if (!Array.isArray(lastMessage.swipes)) lastMessage.swipes = [lastMessage.mes];
          lastMessage.swipes.push('');
          lastMessage.swipe_id = lastMessage.swipes.length - 1;
          lastMessage.mes = '';
        } else {
          // Continue
          targetMessageIndex = activeChatMessages.length - 1;
        }

        try {
          for await (const chunk of streamGenerator()) {
            const chunkController = new AbortController();
            await eventEmitter.emit('process:stream-chunk', chunk, payload, chunkController);
            if (chunkController.signal.aborted) {
              generationController.value?.abort();
              break;
            }
            if (chunk.reasoning) streamedReasoning += chunk.reasoning;

            const targetMessage = activeChatMessages[targetMessageIndex];
            // Ensure types exist
            if (!targetMessage.swipes) targetMessage.swipes = [''];
            if (targetMessage.swipe_id === undefined) targetMessage.swipe_id = 0;
            if (!targetMessage.extra) targetMessage.extra = {};

            if (
              mode === GenerationMode.ADD_SWIPE ||
              mode === GenerationMode.NEW ||
              mode === GenerationMode.REGENERATE
            ) {
              targetMessage.swipes[targetMessage.swipe_id] += chunk.delta;
              targetMessage.mes = targetMessage.swipes[targetMessage.swipe_id];
            } else {
              targetMessage.mes += chunk.delta;
              if (targetMessage.swipes[targetMessage.swipe_id] !== undefined) {
                targetMessage.swipes[targetMessage.swipe_id] = targetMessage.mes;
              }
            }
            if (chunk.reasoning) targetMessage.extra.reasoning = streamedReasoning;
          }
        } finally {
          const finalMessage = activeChatMessages[targetMessageIndex];
          if (finalMessage) {
            finalMessage.gen_finished = new Date().toISOString();
            if (!finalMessage.extra) finalMessage.extra = {};
            finalMessage.extra.token_count = await tokenizer.getTokenCount(finalMessage.mes);

            const swipeInfo: SwipeInfo = {
              send_date: finalMessage.send_date!,
              gen_started: genStarted,
              gen_finished: finalMessage.gen_finished,
              extra: { ...finalMessage.extra },
            };
            if (!finalMessage.swipe_info) finalMessage.swipe_info = [];

            if (mode === GenerationMode.NEW || mode === GenerationMode.REGENERATE) {
              finalMessage.swipe_info = [swipeInfo];
            } else if (mode === GenerationMode.ADD_SWIPE) {
              finalMessage.swipe_info.push(swipeInfo);
            }
          }
        }
      }
    } catch (error) {
      generationError = error instanceof Error ? error : new Error(String(error));

      if (generationError.name === 'AbortError') {
        toast.info('Generation aborted.');
      } else {
        console.error('Failed to generate response:', generationError);
        toast.error(generationError.message || t('chat.generate.errorFallback'));
      }
    } finally {
      isGenerating.value = false;
      generationController.value = null;
      await nextTick();
      await eventEmitter.emit('generation:finished', generatedMessage, generationError);
    }
  }

  return {
    isGenerating,
    generateResponse,
    sendMessage,
    abortGeneration,
  };
}
