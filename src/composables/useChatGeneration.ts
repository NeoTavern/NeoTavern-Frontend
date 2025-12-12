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
import { useGroupChatStore } from '../stores/group-chat.store';
import { usePersonaStore } from '../stores/persona.store';
import { usePromptStore } from '../stores/prompt.store';
import { useSettingsStore } from '../stores/settings.store';
import { useUiStore } from '../stores/ui.store';
import { useWorldInfoStore } from '../stores/world-info.store';
import { getThumbnailUrl } from '../utils/character';
import { getCharactersForContext } from '../utils/chat';
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
  const groupChatStore = useGroupChatStore();
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
      groupChatStore.generatingAvatar = null;
    }
  }

  async function sendMessage(
    messageText: string,
    { triggerGeneration = true, generationId }: { triggerGeneration?: boolean; generationId?: string } = {},
  ) {
    if (!personaStore.activePersona) {
      toast.error(t('chat.generate.noPersonaError'));
      return;
    }
    if (!messageText.trim() || isGenerating.value || deps.activeChat.value === null) {
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
    initialMode: GenerationMode,
    { generationId, forceSpeakerAvatar }: { generationId?: string; forceSpeakerAvatar?: string } = {},
  ) {
    if (isGenerating.value) return;

    if (!deps.activeChat.value) {
      console.error('Attempted to generate response without an active chat.');
      return;
    }

    let mode = initialMode;
    const currentChatContext = deps.activeChat.value;

    // Handle Regenerate Logic:
    // If regenerating the last message (bot), we force that avatar and treat it as a single generation.
    // If the last message is user, we treat it as NEW (response to user).
    if (mode === GenerationMode.REGENERATE) {
      const lastMsg = currentChatContext.messages[currentChatContext.messages.length - 1];
      if (lastMsg) {
        if (lastMsg.is_user) {
          mode = GenerationMode.NEW;
        } else {
          forceSpeakerAvatar = lastMsg.original_avatar;
          // Pop the message to be regenerated
          currentChatContext.messages.pop();
          await nextTick();
        }
      }
    } else if (mode === GenerationMode.ADD_SWIPE || mode === GenerationMode.CONTINUE) {
      // These modes imply working on the last message
      const lastMsg = currentChatContext.messages[currentChatContext.messages.length - 1];
      if (!lastMsg || lastMsg.is_user) return;
    }

    // Queue Preparation
    if (forceSpeakerAvatar) {
      groupChatStore.clearQueue();
      groupChatStore.addToQueue([forceSpeakerAvatar]);
    } else if (mode === GenerationMode.NEW) {
      // Only auto-fill queue for new generations
      if (groupChatStore.generationQueue.length === 0) {
        let textToScan = '';
        const lastMsg = currentChatContext.messages[currentChatContext.messages.length - 1];
        if (lastMsg && lastMsg.is_user) textToScan = lastMsg.mes;
        groupChatStore.prepareGenerationQueue(textToScan);
      }
    } else {
      // For Continue/Swipe, we are working on existing message, so queue is irrelevant or implicit 1
      // But we need to ensure we have a "current speaker" set up for logic below
      if (groupChatStore.generationQueue.length === 0) {
        const lastMsg = currentChatContext.messages[currentChatContext.messages.length - 1];
        if (lastMsg && !lastMsg.is_user) {
          groupChatStore.addToQueue([lastMsg.original_avatar]);
        }
      }
    }

    if (groupChatStore.generationQueue.length === 0) {
      // If still empty (e.g. Manual mode), stop.
      // Or notify? SillyTavern usually just stops.
      return;
    }

    const finalGenerationId = generationId || uuidv4();
    isGenerating.value = true;
    generationController.value = new AbortController();

    try {
      while (groupChatStore.generationQueue.length > 0) {
        if (generationController.value?.signal.aborted) break;
        if (deps.activeChat.value !== currentChatContext) break;

        const activeAvatar = groupChatStore.popFromQueue();
        if (!activeAvatar) break;

        groupChatStore.generatingAvatar = activeAvatar;
        const activeCharacter = characterStore.activeCharacters.find((c) => c.avatar === activeAvatar);

        if (!activeCharacter) {
          toast.error(t('chat.generate.noSpeaker'));
          break;
        }

        const startController = new AbortController();
        await eventEmitter.emit('generation:started', { controller: startController, generationId: finalGenerationId });
        if (startController.signal.aborted) break;

        // Perform Single Generation
        await performSingleGeneration(activeCharacter, mode, finalGenerationId, currentChatContext);

        groupChatStore.generatingAvatar = null;

        // If not NEW mode, we only do one pass (Swipes/Regen/Continue are singular actions)
        if (mode !== GenerationMode.NEW) break;
      }
    } catch (error) {
      console.error('Generation Error:', error);
      toast.error(error instanceof Error ? error.message : t('chat.generate.errorFallback'));
    } finally {
      isGenerating.value = false;
      groupChatStore.generatingAvatar = null;
      generationController.value = null;
    }
  }

  async function performSingleGeneration(
    activeCharacter: Character,
    mode: GenerationMode,
    generationId: string,
    chatContext: ChatStateRef,
  ) {
    let generatedMessage: ChatMessage | null = null;
    let generationError: Error | undefined;

    const activeChatMessages = chatContext.messages;
    const genStarted = new Date().toISOString();
    const activePersona = personaStore.activePersona;
    if (!activePersona) throw new Error(t('chat.generate.noPersonaError'));

    const settings = settingsStore.settings;
    const chatMetadata = chatContext.metadata;

    // Connection Profile
    const connectionProfileName = chatMetadata.connection_profile;
    let profileSettings: ConnectionProfile | null = null;
    if (connectionProfileName) {
      profileSettings = apiStore.connectionProfiles.find((p) => p.name === connectionProfileName) || null;
    }

    const effectiveProvider = profileSettings?.provider || settings.api.provider;
    let effectiveModel = profileSettings?.model;
    if (!effectiveModel) {
      effectiveModel = settings.api.selectedProviderModels[effectiveProvider] || apiStore.activeModel || '';
    }

    if (!effectiveModel) throw new Error(t('chat.generate.noModelError'));

    // Sampler
    let effectiveSamplerSettings = settings.api.samplers;
    if (profileSettings?.sampler) {
      if (apiStore.presets.length === 0) await apiStore.loadPresetsForApi();
      const preset = apiStore.presets.find((p) => p.name === profileSettings!.sampler);
      if (preset) effectiveSamplerSettings = preset.preset;
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

    const clonedSampler = {
      ...effectiveSamplerSettings,
      stop: [...(effectiveSamplerSettings.stop || [])],
    };

    const context: GenerationContext = {
      generationId,
      mode,
      characters: charactersForContext,
      chatMetadata: chatMetadata,
      history: [...activeChatMessages],
      persona: activePersona,
      settings: {
        sampler: clonedSampler,
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

    if (deps.activeChat.value !== chatContext) throw new Error('Context switched');

    // Trim history for Swipe
    const lastMessage = context.history.length > 0 ? context.history[context.history.length - 1] : null;
    if (mode === GenerationMode.ADD_SWIPE) {
      if (lastMessage && !lastMessage.is_user) {
        context.history.pop();
      }
    }

    let effectivePostProcessing = settings.api.customPromptPostProcessing;
    if (profileSettings?.customPromptPostProcessing) {
      effectivePostProcessing = profileSettings.customPromptPostProcessing;
    }

    // Handle "Stop if line starts with non-active character" logic
    const stopOnNameHijack = settings.chat.stopOnNameHijack ?? 'all';
    const isGroupChat = groupChatStore.isGroupChat;
    const shouldCheckHijack =
      effectivePostProcessing || // Post processing already prefixing names
      stopOnNameHijack === 'all' ||
      (stopOnNameHijack === 'group' && isGroupChat) ||
      (stopOnNameHijack === 'single' && !isGroupChat);

    const stopNames = new Set<string>();
    if (shouldCheckHijack) {
      const stops = new Set(context.settings.sampler.stop);

      // Add other characters
      characterStore.activeCharacters.forEach((c) => {
        if (c.avatar !== activeCharacter.avatar) {
          stops.add(`\n${c.name}:`);
          stopNames.add(c.name.trim());
        }
      });
      // Add user
      if (context.playerName) {
        stops.add(`\n${context.playerName}:`);
        stopNames.add(context.playerName.trim());
      }

      context.settings.sampler.stop = Array.from(stops);
    }

    await eventEmitter.emit('process:generation-context', context);
    if (context.controller.signal.aborted) return;

    const promptBuilder = new PromptBuilder({
      generationId,
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

    if (deps.activeChat.value !== chatContext) throw new Error('Context switched');

    const messages = await promptBuilder.build();
    if (messages.length === 0) throw new Error(t('chat.generate.noPrompts'));

    // Inject Assistant Prefix for Group Chats
    // "In group generations, we need to prefix the name with {role: assistant, content: `${name}: `}"
    // FIXME: "Generate" button doesn't work if the last message is assistant
    // FIXME: Reasoning not going to work in group chats because of prefill logic
    if (
      groupChatStore.isGroupChat &&
      [GenerationMode.NEW, GenerationMode.REGENERATE, GenerationMode.ADD_SWIPE].includes(mode)
    ) {
      messages.push({
        role: 'assistant',
        content: `${activeCharacter.name}: `,
        name: activeCharacter.name,
      });
    }

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

    let swipeId = 0;
    if (mode === GenerationMode.ADD_SWIPE) {
      const lastMsg = activeChatMessages[activeChatMessages.length - 1];
      swipeId = Array.isArray(lastMsg?.swipes) ? lastMsg.swipes.length : 1;
    } else if (mode === GenerationMode.CONTINUE) {
      const lastMsg = activeChatMessages[activeChatMessages.length - 1];
      swipeId = lastMsg?.swipe_id ?? 0;
    }

    const itemizedPrompt: ItemizedPrompt = {
      generationId,
      messageIndex: [GenerationMode.CONTINUE, GenerationMode.ADD_SWIPE].includes(mode)
        ? activeChatMessages.length - 1
        : activeChatMessages.length,
      swipeId,
      model: context.settings.model,
      api: context.settings.provider,
      tokenizer: settings.api.tokenizer,
      presetName: profileSettings?.sampler || settings.api.selectedSampler || 'Default',
      messages: messages,
      breakdown: breakdown,
      timestamp: Date.now(),
      worldInfoEntries: promptBuilder.processedWorldInfo?.triggeredEntries ?? {},
    };
    promptStore.addItemizedPrompt(itemizedPrompt);

    let effectiveMessages = [...messages];
    if (effectivePostProcessing) {
      try {
        const isPrefill = messages.length > 1 ? messages[messages.length - 1].role === 'assistant' : false;
        const lastPrefillMessage = isPrefill ? messages.pop() : null;
        effectiveMessages = await ChatCompletionService.formatMessages(
          effectiveMessages || [],
          effectivePostProcessing,
        );
        if (lastPrefillMessage) {
          if (!lastPrefillMessage.content.startsWith(`${lastPrefillMessage.name}: `)) {
            lastPrefillMessage.content = `${lastPrefillMessage.name}: ${lastPrefillMessage.content}`;
          }
          effectiveMessages.push(lastPrefillMessage);
        }
      } catch (e) {
        console.error('Post-processing failed:', e);
        toast.error(t('chat.generate.postProcessError'));
        throw e;
      }
    }

    const payloadRaw = {
      messages: effectiveMessages,
      model: context.settings.model,
      samplerSettings: context.settings.sampler,
      provider: context.settings.provider,
      providerSpecific: context.settings.providerSpecific,
      proxy: settings.api.proxy,
      playerName: context.playerName,
      modelList: apiStore.modelList,
      formatter: context.settings.formatter,
      instructTemplate: context.settings.instructTemplate,
      activeCharacter: activeCharacter,
    };

    const payload = buildChatCompletionPayload(payloadRaw);

    const payloadController = new AbortController();
    await eventEmitter.emit('process:request-payload', payload, {
      controller: payloadController,
      generationId,
    });
    if (payloadController.signal.aborted) return;

    // --- Generation Execution ---

    const handleGenerationResult = async (content: string, reasoning?: string) => {
      if (deps.activeChat.value !== chatContext) {
        console.warn('Chat context changed during generation. Result ignored.');
        return;
      }

      // Apply trimming logic (Post-processing)
      let finalContent = content;

      // Handle name hijack clipping for non-streaming response
      if (shouldCheckHijack) {
        const lines = finalContent.split('\n');
        let cutoffIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const match = line.match(/^\s*(.{1,50}?):\s/);
          if (match) {
            const name = match[1].trim();
            if (stopNames.has(name)) {
              cutoffIndex = i;
              break;
            }
          }
        }
        if (cutoffIndex !== -1) {
          finalContent = lines.slice(0, cutoffIndex).join('\n');
        }
      }

      if (context.settings.formatter === 'text' && context.settings.instructTemplate) {
        finalContent = trimInstructResponse(finalContent, context.settings.instructTemplate);
      }

      const genFinished = new Date().toISOString();
      const token_count = await tokenizer.getTokenCount(finalContent);
      const swipeInfo: SwipeInfo = {
        send_date: getMessageTimeStamp(),
        gen_started: genStarted,
        gen_finished: genFinished,
        generation_id: generationId,
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
        // NEW or REGENERATE
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
          generationId,
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
        effectiveFormatter,
        generationController.value!.signal,
      )) as GenerationResponse;

      if (deps.activeChat.value !== chatContext) throw new Error('Context switched');

      const responseController = new AbortController();
      await eventEmitter.emit('process:response', response, {
        payload,
        controller: responseController,
        generationId,
      });
      if (!responseController.signal.aborted) {
        await handleGenerationResult(response.content, response.reasoning);
      }
    } else {
      // Streaming
      const streamGenerator = (await ChatCompletionService.generate(
        payload,
        effectiveFormatter,
        generationController.value!.signal,
      )) as unknown as () => AsyncGenerator<StreamedChunk>;

      let targetMessageIndex = -1;

      // Initialize placeholder message
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
          generationId,
        });
        if (createController.signal.aborted) return;

        if (deps.activeChat.value !== chatContext) throw new Error('Context switched');

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
        lastMessage.extra.display_text = '';
        lastMessage.extra.reasoning_display_text = '';
      } else {
        // Continue
        targetMessageIndex = activeChatMessages.length - 1;
      }

      try {
        for await (const chunk of streamGenerator()) {
          const chunkController = new AbortController();
          await eventEmitter.emit('process:stream-chunk', chunk, {
            payload,
            controller: chunkController,
            generationId,
          });
          if (chunkController.signal.aborted) {
            generationController.value?.abort();
            break;
          }

          const targetMessage = activeChatMessages[targetMessageIndex];
          if (!targetMessage.swipes) targetMessage.swipes = [''];
          if (targetMessage.swipe_id === undefined) targetMessage.swipe_id = 0;
          if (!targetMessage.extra) targetMessage.extra = {};

          if (mode === GenerationMode.ADD_SWIPE || mode === GenerationMode.NEW || mode === GenerationMode.REGENERATE) {
            targetMessage.swipes[targetMessage.swipe_id] += chunk.delta;
            targetMessage.mes = targetMessage.swipes[targetMessage.swipe_id];
          } else {
            targetMessage.mes += chunk.delta;
            if (targetMessage.swipes[targetMessage.swipe_id] !== undefined) {
              targetMessage.swipes[targetMessage.swipe_id] = targetMessage.mes;
            }
          }
          if (chunk.reasoning && chunk.reasoning !== targetMessage.extra.reasoning)
            targetMessage.extra.reasoning = chunk.reasoning;

          // Check for name hijacking/hallucinations
          if (shouldCheckHijack) {
            const lastNewLine = targetMessage.mes.lastIndexOf('\n');
            const currentLine = lastNewLine === -1 ? targetMessage.mes : targetMessage.mes.slice(lastNewLine + 1);
            // Look for "Name: " pattern at start of line
            const match = currentLine.match(/^\s*(.{1,50}?):\s/);
            if (match) {
              const detectedName = match[1].trim();
              if (stopNames.has(detectedName)) {
                generationController.value?.abort();

                // Trim the unwanted line
                const contentToKeep = lastNewLine === -1 ? '' : targetMessage.mes.slice(0, lastNewLine);
                targetMessage.mes = contentToKeep;
                if (
                  targetMessage.swipes &&
                  targetMessage.swipe_id !== undefined &&
                  targetMessage.swipes[targetMessage.swipe_id] !== undefined
                ) {
                  targetMessage.swipes[targetMessage.swipe_id] = contentToKeep;
                }

                break;
              }
            }
          }
        }
      } finally {
        // Finalize streaming
        const finalMessage = activeChatMessages[targetMessageIndex];
        if (finalMessage) {
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
            generation_id: generationId,
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
    await nextTick();
    await eventEmitter.emit(
      'generation:finished',
      { message: generatedMessage, error: generationError },
      { generationId },
    );
  }

  return {
    isGenerating,
    generateResponse,
    sendMessage,
    abortGeneration,
  };
}
