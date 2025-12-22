import { computed, nextTick, ref, type Ref } from 'vue';
import { buildChatCompletionPayload, ChatCompletionService } from '../api/generation';
import { ApiTokenizer } from '../api/tokenizer';
import { default_user_avatar, GenerationMode } from '../constants';
import {
  type Character,
  type ChatMessage,
  type ChatMetadata,
  type ConnectionProfile,
  type GenerationContext,
  type GenerationPayloadBuilderConfig,
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
  syncSwipeToMes: (msgIndex: number, swipeIndex: number) => Promise<void>;
  stopAutoModeTimer: () => void;
}

export function useChatGeneration(deps: ChatGenerationDependencies) {
  const { t } = useStrictI18n();

  // Internal state for actual generation
  const _isGenerating = ref(false);
  // State for context resolution / group orchestration (LLM decisions, etc.)
  const isPreparing = ref(false);

  const isGenerating = computed(() => _isGenerating.value || isPreparing.value);

  const generationController = ref<AbortController | null>(null);
  const currentGenerationId = ref<string | null>(null);

  const characterStore = useCharacterStore();
  const apiStore = useApiStore();
  const settingsStore = useSettingsStore();
  const promptStore = usePromptStore();
  const personaStore = usePersonaStore();
  const worldInfoStore = useWorldInfoStore();
  const uiStore = useUiStore();

  async function abortGeneration() {
    if (generationController.value) {
      generationController.value.abort();
    }

    const genId = currentGenerationId.value;

    // Reset states
    _isGenerating.value = false;
    isPreparing.value = false;
    generationController.value = null;
    currentGenerationId.value = null;

    if (genId) {
      await eventEmitter.emit('generation:aborted', { generationId: genId });
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
    // Prevent generation if already actively writing text.
    if (_isGenerating.value) return;

    // If we are in the preparation phase (deciding speaker),
    // we only allow proceed if a speaker is explicitly forced (handoff from extension).
    // This allows the recursive call from the extension to proceed while the parent call is technically "preparing".
    if (isPreparing.value && !forceSpeakerAvatar) return;

    if (!deps.activeChat.value) {
      console.error('Attempted to generate response without an active chat.');
      return;
    }

    let mode = initialMode;
    const currentChatContext = deps.activeChat.value;

    // Handle Regenerate Logic
    if (mode === GenerationMode.REGENERATE) {
      const lastMsg = currentChatContext.messages[currentChatContext.messages.length - 1];
      if (lastMsg) {
        if (lastMsg.is_user) {
          mode = GenerationMode.NEW;
        } else {
          forceSpeakerAvatar = forceSpeakerAvatar ?? lastMsg.original_avatar;
          // Pop the message to be regenerated
          currentChatContext.messages.pop();
        }
      }
    } else if (mode === GenerationMode.ADD_SWIPE || mode === GenerationMode.CONTINUE) {
      const lastMsg = currentChatContext.messages[currentChatContext.messages.length - 1];
      if (!lastMsg || lastMsg.is_user) return;
      forceSpeakerAvatar = forceSpeakerAvatar ?? lastMsg.original_avatar;
    }

    const finalGenerationId = generationId || uuidv4();
    currentGenerationId.value = finalGenerationId;

    // Create a controller for the entire generation process (including prep/orchestration)
    const overallController = new AbortController();
    generationController.value = overallController;

    let generatedMessage: ChatMessage | null = null;
    let generationError: Error | undefined;
    let handledByExtension = false;

    try {
      let activeCharacter: Character | undefined;

      if (forceSpeakerAvatar) {
        activeCharacter = characterStore.activeCharacters.find((c) => c.avatar === forceSpeakerAvatar);
      } else {
        // We are entering the "Who speaks?" phase. Lock it.
        isPreparing.value = true;

        try {
          // Ask extensions if they want to handle it (e.g. Group Chat Queue / LLM Decision)
          const payload = {
            mode,
            generationId: finalGenerationId,
            handled: false,
          };

          await eventEmitter.emit('chat:generation-requested', payload, { controller: overallController });

          if (overallController.signal.aborted) {
            // If aborted during prep
            return;
          }

          if (payload.handled) {
            // Extension handled it (e.g. scheduled the queue).
            // We exit here. The extension is responsible for calling generateResponse again with a forced speaker.
            handledByExtension = true;
            return;
          }

          // If no force speaker and not handled by extension, we assume single chat (first char)
          activeCharacter = characterStore.activeCharacters[0];
        } finally {
          isPreparing.value = false;
        }
      }

      if (overallController.signal.aborted) return;

      if (!activeCharacter) {
        // Fallback: If no characters active (weird), try to find any in store.
        if (characterStore.characters.length > 0) {
          activeCharacter = characterStore.characters[0];
        } else {
          toast.error(t('chat.generate.noSpeaker'));
          return;
        }
      }

      // Now we commit to generation
      _isGenerating.value = true;

      const startController = new AbortController();
      await eventEmitter.emit('generation:started', {
        controller: startController,
        generationId: finalGenerationId,
        activeCharacter,
      });
      if (startController.signal.aborted) return;
      if (overallController.signal.aborted) return;

      generatedMessage = await performSingleGeneration(
        activeCharacter,
        mode,
        finalGenerationId,
        currentChatContext,
        overallController,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Silent catch for user abort
        console.log('Generation aborted by user.');
      } else {
        console.error('Generation Error:', error);
        generationError = error instanceof Error ? error : new Error(String(error));
        toast.error(generationError.message || t('chat.generate.errorFallback'));
      }
    } finally {
      // If we were generating (and not just prepping/handled), finalize
      if (_isGenerating.value && !handledByExtension) {
        _isGenerating.value = false;
        generationController.value = null;
        currentGenerationId.value = null;

        await nextTick();
        await eventEmitter.emit(
          'generation:finished',
          { message: generatedMessage, error: generationError },
          { generationId: finalGenerationId, mode },
        );
      }
    }
  }

  async function performSingleGeneration(
    activeCharacter: Character,
    mode: GenerationMode,
    generationId: string,
    chatContext: ChatStateRef,
    controller: AbortController,
  ): Promise<ChatMessage | null> {
    const abortSignal = controller.signal;
    let generatedMessage: ChatMessage | null = null;

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

    // Event-driven Context Resolution
    const contextCharactersWrapper = { characters: [activeCharacter] };
    await eventEmitter.emit('generation:resolve-context', contextCharactersWrapper);
    const charactersForContext = contextCharactersWrapper.characters;

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

    // Name Hijacking Logic
    const stopOnNameHijack = settings.chat.stopOnNameHijack ?? 'all';
    const isMultiCharContext = context.characters.length > 1;

    const shouldCheckHijack =
      effectivePostProcessing ||
      stopOnNameHijack === 'all' ||
      (stopOnNameHijack === 'group' && isMultiCharContext) ||
      (stopOnNameHijack === 'single' && !isMultiCharContext);

    // Populate initial stop sequences
    const stopNames = new Set<string>();
    const initialStops = new Set(context.settings.sampler.stop);

    if (shouldCheckHijack) {
      // Add other characters
      context.characters.forEach((c) => {
        if (c.avatar !== activeCharacter.avatar) {
          initialStops.add(`\n${c.name}:`);
          stopNames.add(c.name.trim());
        }
      });
      // Add user
      if (context.playerName) {
        initialStops.add(`\n${context.playerName}:`);
        stopNames.add(context.playerName.trim());
      }

      context.settings.sampler.stop = Array.from(initialStops);
    }

    await eventEmitter.emit('process:generation-context', context);
    if (context.controller.signal.aborted) return null;

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

    // Handle (Continue) injection
    // If the last message is an assistant message that doesn't look like a prefill (ends in ':'),
    // we inject a user message with '(Continue)' to force a new turn.
    // If it looks like a prefill, we assume the model will complete it naturally.
    const lastPromptMsg = messages[messages.length - 1];
    if (
      context.chatMetadata.members &&
      context.chatMetadata.members.length === 1 &&
      lastPromptMsg?.role === 'assistant' &&
      !lastPromptMsg.content.trim().endsWith(':') &&
      [GenerationMode.NEW, GenerationMode.REGENERATE, GenerationMode.ADD_SWIPE].includes(mode)
    ) {
      messages.push({
        role: 'user',
        content: '(Continue)', // TODO: Add it from settings
        name: context.playerName,
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
        // We ensure we operate only on effectiveMessages to avoid duplication.
        const isPrefill =
          effectiveMessages.length > 1
            ? effectiveMessages[effectiveMessages.length - 1].role === 'assistant' &&
              effectiveMessages[effectiveMessages.length - 1].content.trim().endsWith(':')
            : false;

        const lastPrefillMessage = isPrefill ? effectiveMessages.pop() : null;

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

    const payloadRaw: GenerationPayloadBuilderConfig = {
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

    const payloadController = new AbortController();
    await eventEmitter.emit('generation:build-payload', payloadRaw, {
      controller: payloadController,
      generationId,
    });
    if (payloadController.signal.aborted) return null;

    const payload = buildChatCompletionPayload(payloadRaw);

    const requestPayloadController = new AbortController();
    await eventEmitter.emit('process:request-payload', payload, {
      controller: requestPayloadController,
      generationId,
    });
    if (requestPayloadController.signal.aborted) return null;

    // --- Generation Execution ---

    const handleGenerationResult = async (content: string, reasoning?: string) => {
      if (deps.activeChat.value !== chatContext) {
        console.warn('Chat context changed during generation. Result ignored.');
        return;
      }

      // Apply trimming logic
      let finalContent = content;

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
        if (createController.signal.aborted) return null;

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
        abortSignal,
      )) as GenerationResponse;

      if (deps.activeChat.value !== chatContext) throw new Error('Context switched');

      const responseController = new AbortController();
      await eventEmitter.emit('process:response', response, {
        payload,
        controller: responseController,
        generationId,
      });
      if (!responseController.signal.aborted) {
        if (!response.content || response.content.trim() === '') {
          toast.error(t('chat.generate.emptyResponseError'));
          return null;
        }
        await handleGenerationResult(response.content, response.reasoning);
      }
    } else {
      // Streaming
      const streamGenerator = (await ChatCompletionService.generate(
        payload,
        effectiveFormatter,
        abortSignal,
      )) as unknown as () => AsyncGenerator<StreamedChunk>;

      let targetMessageIndex = -1;
      let messageCreated = false;

      // For CONTINUE mode, we work on existing message
      if (mode === GenerationMode.CONTINUE) {
        targetMessageIndex = activeChatMessages.length - 1;
        messageCreated = true;
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
            controller.abort();
            break;
          }

          // Create message on first chunk with content
          if (!messageCreated && chunk.delta && chunk.delta.trim()) {
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
              if (createController.signal.aborted) return null;

              if (deps.activeChat.value !== chatContext) throw new Error('Context switched');

              activeChatMessages.push(botMessage);
              generatedMessage = botMessage;
              targetMessageIndex = activeChatMessages.length - 1;
              messageCreated = true;
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
              messageCreated = true;
            }
          }

          // Skip processing if no message created yet
          if (!messageCreated) continue;

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

          // Check for name hijacking/hallucinations (Stream)
          if (shouldCheckHijack) {
            const lastNewLine = targetMessage.mes.lastIndexOf('\n');
            const currentLine = lastNewLine === -1 ? targetMessage.mes : targetMessage.mes.slice(lastNewLine + 1);
            // Look for "Name: " pattern at start of line
            const match = currentLine.match(/^\s*(.{1,50}?):\s/);
            if (match) {
              const detectedName = match[1].trim();
              if (stopNames.has(detectedName)) {
                controller.abort();

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
        // Check if we never created a message (empty response)
        if (!messageCreated) {
          toast.error(t('chat.generate.emptyResponseError'));
          return null;
        }

        // Finalize streaming
        const finalMessage = activeChatMessages[targetMessageIndex];
        if (finalMessage) {
          generatedMessage = finalMessage;

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

    return generatedMessage;
  }

  return {
    isGenerating,
    generateResponse,
    sendMessage,
    abortGeneration,
  };
}
