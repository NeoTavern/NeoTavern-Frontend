import { nextTick, ref, type ComputedRef, type Ref } from 'vue';
import { buildChatCompletionPayload, ChatCompletionService } from '../api/generation';
import { ApiTokenizer } from '../api/tokenizer';
import { default_user_avatar, GenerationMode, GroupGenerationHandlingMode } from '../constants';
import {
  type Character,
  type ChatMessage,
  type ChatMetadata,
  type ConnectionProfile,
  type GenerationContext,
  type GenerationResponse,
  type ItemizedPrompt,
  type PromptTokenBreakdown,
  type StreamedChunk,
  type SwipeInfo,
  type WorldInfoBook,
} from '../types';
import { toast } from './useToast';

// Stores
import { PromptBuilder } from '../services/prompt-engine';
import { useApiStore } from '../stores/api.store';
import { useCharacterStore } from '../stores/character.store';
import { usePersonaStore } from '../stores/persona.store';
import { usePromptStore } from '../stores/prompt.store';
import { useSettingsStore } from '../stores/settings.store';
import { useUiStore } from '../stores/ui.store';
import { useWorldInfoStore } from '../stores/world-info.store';
import { getThumbnailUrl } from '../utils/character';
import { determineNextSpeaker, getCharactersForContext } from '../utils/chat';
import { getMessageTimeStamp, uuidv4 } from '../utils/commons';
import { eventEmitter } from '../utils/extensions';
import { trimInstructResponse } from '../utils/instruct';
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

  async function sendMessage(
    messageText: string,
    { triggerGeneration = true, generationId }: { triggerGeneration?: boolean; generationId?: string } = {},
  ) {
    if (!messageText.trim() || isGenerating.value || deps.activeChat.value === null || !personaStore.activePersona) {
      return;
    }

    deps.stopAutoModeTimer();

    const currentChatContext = deps.activeChat.value;

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

    if (deps.activeChat.value !== currentChatContext) {
      console.warn('Chat context changed during message creation. Message dropped.');
      return;
    }

    deps.activeChat.value.messages.push(userMessage);
    await nextTick();
    await eventEmitter.emit('message:created', userMessage);

    if (triggerGeneration) {
      await generateResponse(GenerationMode.NEW, { generationId });
    }
  }

  async function generateResponse(
    mode: GenerationMode,
    { generationId, forceSpeakerAvatar }: { generationId?: string; forceSpeakerAvatar?: string } = {},
  ) {
    if (isGenerating.value) return;

    if (!deps.activeChat.value) {
      console.error('Attempted to generate response without an active chat.');
      return;
    }

    const currentChatContext = deps.activeChat.value;
    const finalGenerationId = generationId || uuidv4();

    const startController = new AbortController();
    await eventEmitter.emit('generation:started', { controller: startController, generationId: finalGenerationId });
    if (startController.signal.aborted) {
      return;
    }

    if (generationController.value) {
      generationController.value.abort();
    }
    generationController.value = new AbortController();

    if (deps.activeChat.value !== currentChatContext) return;

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
          currentChatContext.messages,
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

    const activeChatMessages = currentChatContext.messages;

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

      const chatMetadata = currentChatContext.metadata;
      const connectionProfileName = chatMetadata.connection_profile;
      let profileSettings: ConnectionProfile | null = null;

      if (connectionProfileName) {
        const profile = apiStore.connectionProfiles.find((p) => p.name === connectionProfileName);
        if (profile) {
          profileSettings = profile;
        }
      }

      // Determine Provider
      const effectiveProvider = profileSettings?.provider || settings.api.provider;

      // Determine Model
      let effectiveModel = profileSettings?.model;
      if (!effectiveModel) {
        effectiveModel = settings.api.selectedProviderModels[effectiveProvider] || apiStore.activeModel || '';
      }

      // TODO: Make generic
      if (!effectiveModel && effectiveProvider !== 'koboldcpp') throw new Error(t('chat.generate.noModelError'));

      // Determine Sampler Settings
      let effectiveSamplerSettings = settings.api.samplers;
      if (profileSettings?.sampler) {
        if (apiStore.presets.length === 0) {
          await apiStore.loadPresetsForApi();
        }
        const preset = apiStore.presets.find((p) => p.name === profileSettings!.sampler);
        if (preset) {
          effectiveSamplerSettings = preset.preset;
        }
      }

      const effectiveFormatter = profileSettings?.formatter || settings.api.formatter;
      const effectiveTemplateName = profileSettings?.instructTemplate || settings.api.instructTemplateName;
      const effectiveTemplate = apiStore.instructTemplates.find((t) => t.name === effectiveTemplateName);

      const tokenizer = new ApiTokenizer({ tokenizerType: settings.api.tokenizer, model: effectiveModel });
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
        generationId: finalGenerationId,
        mode,
        characters: charactersForContext,
        chatMetadata: currentChatContext.metadata,
        history: chatHistoryForPrompt,
        persona: activePersona,
        settings: {
          sampler: effectiveSamplerSettings,
          provider: effectiveProvider,
          model: effectiveModel,
          providerSpecific: settings.api.providerSpecific,
          formatter: effectiveFormatter,
          instructTemplate: effectiveTemplate,
        },
        playerName: uiStore.activePlayerName || 'User',
        controller: new AbortController(),
        tokenizer: tokenizer,
      };

      if (deps.activeChat.value !== currentChatContext) throw new Error('Context switched');

      await eventEmitter.emit('process:generation-context', context);
      if (context.controller.signal.aborted) return;

      const promptBuilder = new PromptBuilder({
        generationId: finalGenerationId,
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

      if (deps.activeChat.value !== currentChatContext) throw new Error('Context switched');

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
        generationId: finalGenerationId,
        messageIndex: mode === GenerationMode.CONTINUE ? activeChatMessages.length - 1 : activeChatMessages.length,
        model: context.settings.model,
        api: context.settings.provider,
        tokenizer: settings.api.tokenizer,
        presetName: profileSettings?.sampler || settings.api.selectedSampler || 'Default',
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
        provider: context.settings.provider,
        providerSpecific: context.settings.providerSpecific,
        playerName: context.playerName,
        modelList: apiStore.modelList,
        formatter: context.settings.formatter,
        instructTemplate: context.settings.instructTemplate,
        activeCharacter: activeCharacter,
      });

      const payloadController = new AbortController();
      await eventEmitter.emit('process:request-payload', payload, {
        controller: payloadController,
        generationId: finalGenerationId,
      });
      if (payloadController.signal.aborted) return;

      const handleGenerationResult = async (content: string, reasoning?: string) => {
        if (deps.activeChat.value !== currentChatContext) {
          console.warn('Chat context changed during generation. Result ignored.');
          return;
        }

        // Apply trimming logic (Post-processing)
        let finalContent = content;
        if (context.settings.formatter === 'text' && context.settings.instructTemplate) {
          finalContent = trimInstructResponse(content, context.settings.instructTemplate);
        }

        const genFinished = new Date().toISOString();
        const token_count = await tokenizer.getTokenCount(finalContent);
        const swipeInfo: SwipeInfo = {
          send_date: getMessageTimeStamp(),
          gen_started: genStarted,
          gen_finished: genFinished,
          generation_id: finalGenerationId,
          extra: { reasoning, token_count },
        };

        if (mode === GenerationMode.CONTINUE && lastMessage) {
          lastMessage.mes += finalContent;
          lastMessage.gen_finished = genFinished;
          if (!lastMessage.extra) lastMessage.extra = {};
          lastMessage.extra.token_count = await tokenizer.getTokenCount(lastMessage.mes);

          if (
            lastMessage.swipes &&
            lastMessage.swipe_id !== undefined &&
            lastMessage.swipes[lastMessage.swipe_id] !== undefined
          ) {
            lastMessage.swipes[lastMessage.swipe_id] = lastMessage.mes;
          }

          generatedMessage = lastMessage;
          await nextTick();
          await eventEmitter.emit('message:updated', activeChatMessages.length - 1, lastMessage);
        } else if (mode === GenerationMode.ADD_SWIPE && lastMessage) {
          if (!Array.isArray(lastMessage.swipes)) lastMessage.swipes = [lastMessage.mes];
          if (!Array.isArray(lastMessage.swipe_info)) lastMessage.swipe_info = [];
          lastMessage.swipes.push(finalContent);
          lastMessage.swipe_info.push(swipeInfo);
          await deps.syncSwipeToMes(activeChatMessages.length - 1, lastMessage.swipes.length - 1);
          generatedMessage = lastMessage;
        } else {
          // New Message (NEW or REGENERATE)
          const botMessage: ChatMessage = {
            name: activeCharacter!.name,
            is_user: false,
            mes: finalContent,
            send_date: swipeInfo.send_date,
            gen_started: genStarted,
            gen_finished: genFinished,
            is_system: false,
            swipes: [finalContent],
            swipe_info: [swipeInfo],
            swipe_id: 0,
            extra: { reasoning, token_count },
            original_avatar: activeCharacter!.avatar,
          };

          const createController = new AbortController();
          await eventEmitter.emit('generation:before-message-create', botMessage, {
            controller: createController,
            generationId: finalGenerationId,
          });
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

        if (deps.activeChat.value !== currentChatContext) throw new Error('Context switched');

        const responseController = new AbortController();
        await eventEmitter.emit('process:response', response, {
          payload,
          controller: responseController,
          generationId: finalGenerationId,
        });
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
          await eventEmitter.emit('generation:before-message-create', botMessage, {
            controller: createController,
            generationId: finalGenerationId,
          });
          if (createController.signal.aborted) return;

          if (deps.activeChat.value !== currentChatContext) throw new Error('Context switched');

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
            if (deps.activeChat.value !== currentChatContext) {
              generationController.value?.abort();
              break;
            }

            const chunkController = new AbortController();
            await eventEmitter.emit('process:stream-chunk', chunk, {
              payload,
              controller: chunkController,
              generationId: finalGenerationId,
            });
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
          if (deps.activeChat.value === currentChatContext) {
            const finalMessage = activeChatMessages[targetMessageIndex];
            if (finalMessage) {
              // Post-processing for streamed text (apply trimming now that stream is done)
              if (context.settings.formatter === 'text' && context.settings.instructTemplate) {
                const trimmed = trimInstructResponse(finalMessage.mes, context.settings.instructTemplate);
                finalMessage.mes = trimmed;
                if (finalMessage.swipes && finalMessage.swipes[finalMessage.swipe_id] !== undefined) {
                  finalMessage.swipes[finalMessage.swipe_id] = trimmed;
                }
              }

              finalMessage.gen_finished = new Date().toISOString();
              if (!finalMessage.extra) finalMessage.extra = {};
              finalMessage.extra.token_count = await tokenizer.getTokenCount(finalMessage.mes);

              const swipeInfo: SwipeInfo = {
                send_date: finalMessage.send_date!,
                gen_started: genStarted,
                gen_finished: finalMessage.gen_finished,
                generation_id: finalGenerationId,
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
      }
    } catch (error) {
      generationError = error instanceof Error ? error : new Error(String(error));

      if (generationError.message === 'Context switched') {
        console.warn('Generation aborted due to context switch');
      } else if (generationError.name === 'AbortError') {
        toast.info('Generation aborted.');
      } else {
        console.error('Failed to generate response:', generationError);
        toast.error(generationError.message || t('chat.generate.errorFallback'));
      }
    } finally {
      isGenerating.value = false;
      generationController.value = null;
      await nextTick();
      if (deps.activeChat.value === currentChatContext) {
        await eventEmitter.emit(
          'generation:finished',
          { message: generatedMessage, error: generationError },
          { generationId: finalGenerationId },
        );
      }
    }
  }

  return {
    isGenerating,
    generateResponse,
    sendMessage,
    abortGeneration,
  };
}
