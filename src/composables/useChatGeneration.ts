import { computed, nextTick, ref, type Ref } from 'vue';
import {
  buildChatCompletionPayload,
  ChatCompletionService,
  processMessagesWithPrefill,
  resolveConnectionProfileSettings,
} from '../api/generation';
import { getModelCapabilities } from '../api/provider-definitions';
import { ApiTokenizer } from '../api/tokenizer';
import { CustomPromptPostProcessing, default_user_avatar, GenerationMode } from '../constants';
import { PromptBuilder } from '../services/prompt-engine';
import { useApiStore } from '../stores/api.store';
import { useCharacterStore } from '../stores/character.store';
import { usePersonaStore } from '../stores/persona.store';
import { usePromptStore } from '../stores/prompt.store';
import { useSettingsStore } from '../stores/settings.store';
import { useUiStore } from '../stores/ui.store';
import { useWorldInfoStore } from '../stores/world-info.store';
import {
  type ApiChatContentPart,
  type Character,
  type ChatMediaItem,
  type ChatMessage,
  type ChatMetadata,
  type GenerationContext,
  type GenerationPayloadBuilderConfig,
  type GenerationResponse,
  type ItemizedPrompt,
  type PromptTokenBreakdown,
  type StreamedChunk,
  type SwipeInfo,
  type WorldInfoBook,
} from '../types';
import { getThumbnailUrl } from '../utils/character';
import { extractMediaFromMarkdown } from '../utils/chat';
import { getMessageTimeStamp, uuidv4 } from '../utils/commons';
import { countTokens, eventEmitter } from '../utils/extensions';
import { trimInstructResponse } from '../utils/instruct';
import { compressImage, getImageTokenCost, getMediaDurationFromDataURL, isDataURL } from '../utils/media';
import { useStrictI18n } from './useStrictI18n';
import { toast } from './useToast';

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
    {
      triggerGeneration = true,
      generationId,
      media = [],
    }: { triggerGeneration?: boolean; generationId?: string; media?: ChatMediaItem[] } = {},
  ) {
    if (!personaStore.activePersona) {
      toast.error(t('chat.generate.noPersonaError'));
      return;
    }
    if ((!messageText.trim() && media.length === 0) || isGenerating.value || deps.activeChat.value === null) {
      return;
    }

    deps.stopAutoModeTimer();

    const currentChatContext = deps.activeChat.value;

    const inlineMedia = extractMediaFromMarkdown(messageText);
    const allMedia = [...media, ...inlineMedia];

    const userMessage: ChatMessage = {
      name: uiStore.activePlayerName || 'User',
      is_user: true,
      mes: messageText.trim(),
      send_date: getMessageTimeStamp(),
      force_avatar: getThumbnailUrl('persona', uiStore.activePlayerAvatar || default_user_avatar),
      original_avatar: personaStore.activePersona.avatarId,
      is_system: false,
      extra: {
        media: allMedia.length > 0 ? allMedia : undefined,
      },
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

    // Resolve connection profile settings
    const {
      provider: effectiveProvider,
      model: effectiveModel,
      samplerSettings: effectiveSamplerSettings,
      formatter: effectiveFormatter,
      instructTemplate: effectiveTemplate,
      reasoningTemplate: effectiveReasoningTemplate,
      providerSpecific: effectiveProviderSpecific,
      customPromptPostProcessing: effectivePostProcessing,
    } = await resolveConnectionProfileSettings({
      profileName: chatMetadata.connection_profile,
    });

    if (!effectiveModel) throw new Error(t('chat.generate.noModelError'));

    const tokenizer = new ApiTokenizer({ tokenizerType: settings.api.tokenizer, model: effectiveModel });

    // Event-driven Context Resolution
    const contextCharactersWrapper = { characters: [JSON.parse(JSON.stringify(activeCharacter))] };
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
        providerSpecific: effectiveProviderSpecific,
        formatter: effectiveFormatter,
        instructTemplate: effectiveTemplate,
        reasoningTemplate: effectiveReasoningTemplate,
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

    const postProcessing = effectivePostProcessing || settings.api.customPromptPostProcessing;

    // Name Hijacking Logic
    const stopOnNameHijack = settings.chat.stopOnNameHijack ?? 'all';
    const isMultiCharContext = context.characters.length > 1;

    const shouldCheckHijack =
      postProcessing ||
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

    // --- Media Hydration Logic ---
    let promptIdx = messages.length - 1;
    let historyIdx = context.history.length - 1;

    let mediaTokenCost = 0;
    const mediaSendingEnabled = settings.api.sendMedia;
    const modelCapabilities = getModelCapabilities(effectiveProvider, effectiveModel, apiStore.modelList);

    // Only attach media if formatter is not 'text' and media sending is enabled
    if (context.settings.formatter !== 'text' && mediaSendingEnabled) {
      while (promptIdx >= 0 && historyIdx >= 0) {
        const pMsg = messages[promptIdx];
        const hMsg = context.history[historyIdx];

        // Map Prompt message to History message by role
        const pRole = pMsg.role;
        const hRole = hMsg.is_user ? 'user' : 'assistant';

        // Very basic matching. Since PromptBuilder preserves order of history, this usually works.
        if (pRole === hRole) {
          if (hMsg.extra?.media && hMsg.extra.media.length > 0) {
            const contentParts: ApiChatContentPart[] = [];
            // Add existing text content
            if (typeof pMsg.content === 'string' && pMsg.content) {
              contentParts.push({ type: 'text', text: pMsg.content });
            } else if (Array.isArray(pMsg.content)) {
              contentParts.push(...pMsg.content);
            }

            const ignoredMedia = hMsg.extra.ignored_media ?? [];
            for (const mediaItem of hMsg.extra.media) {
              // Skip ignored media items
              if (
                ignoredMedia.includes(mediaItem.url) ||
                (mediaItem.source === 'inline' && settingsStore.settings.ui.chat.forbidExternalMedia)
              ) {
                continue;
              }

              try {
                let dataUrl = mediaItem.url;
                if (mediaItem.type === 'image' && modelCapabilities.vision) {
                  const compressed = await compressImage(dataUrl);
                  contentParts.push({
                    type: 'image_url',
                    image_url: {
                      url: compressed,
                      detail: settings.api.imageQuality,
                    },
                  });
                  mediaTokenCost += await getImageTokenCost(compressed, settings.api.imageQuality);
                } else if (
                  (mediaItem.type === 'video' && modelCapabilities.video) ||
                  (mediaItem.type === 'audio' && modelCapabilities.audio)
                ) {
                  if (!isDataURL(dataUrl)) {
                    const response = await fetch(dataUrl);
                    if (response.ok) {
                      const blob = await response.blob();
                      dataUrl = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result as string);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                      });
                    }
                  }

                  if (mediaItem.type === 'video') {
                    contentParts.push({ type: 'video_url', video_url: { url: dataUrl } });
                    mediaTokenCost += 263 * Math.ceil(await getMediaDurationFromDataURL(dataUrl, 'video'));
                  } else {
                    contentParts.push({ type: 'audio_url', audio_url: { url: dataUrl } });
                    mediaTokenCost += 32 * Math.ceil(await getMediaDurationFromDataURL(dataUrl, 'audio'));
                  }
                }
              } catch (e) {
                console.error('Failed to process media item:', e);
              }
            }
            pMsg.content = contentParts;
          }
          historyIdx--;
        }
        promptIdx--;
      }
    }

    // Handle (Continue) injection
    const lastPromptMsg = messages[messages.length - 1];
    let isLastMsgPrefill = false;
    if (lastPromptMsg && lastPromptMsg.role === 'assistant') {
      const contentStr =
        typeof lastPromptMsg.content === 'string'
          ? lastPromptMsg.content
          : Array.isArray(lastPromptMsg.content) && lastPromptMsg.content.length > 0
            ? lastPromptMsg.content[lastPromptMsg.content.length - 1].text || ''
            : '';
      isLastMsgPrefill = contentStr.trim().endsWith(':');
    }

    if (
      context.chatMetadata.members &&
      context.chatMetadata.members.length === 1 &&
      lastPromptMsg?.role === 'assistant' &&
      !isLastMsgPrefill &&
      [GenerationMode.NEW, GenerationMode.REGENERATE, GenerationMode.ADD_SWIPE].includes(mode)
    ) {
      messages.push({
        role: 'user',
        content: '(Continue)', // TODO: Add it from settings
        name: context.playerName,
      });
    }

    const promptTotalText = await Promise.all(messages.map(async (m) => await countTokens(m.content, tokenizer))).then(
      (counts) => counts.reduce((a, b) => a + b, 0),
    );

    const promptTotal = promptTotalText + mediaTokenCost;

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
      if (fullWiText) wiTokens = await countTokens(fullWiText, tokenizer);
    }

    const charDesc = await countTokens(activeCharacter.description || '', tokenizer);
    const charPers = await countTokens(activeCharacter.personality || '', tokenizer);
    const charScen = await countTokens(activeCharacter.scenario || '', tokenizer);
    const charEx = await countTokens(activeCharacter.mes_example || '', tokenizer);
    const personaDesc = await countTokens(activePersona.description || '', tokenizer);

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
      const count = await countTokens(m.content, tokenizer);
      if (m.role === 'system') breakdown.systemTotal += count;
      else breakdown.chatHistory += count;
    }
    // TODO: Add media field
    breakdown.chatHistory += mediaTokenCost;

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
      presetName: chatMetadata.connection_profile || settings.api.selectedSampler || 'Default',
      messages: messages,
      breakdown: breakdown,
      timestamp: Date.now(),
      worldInfoEntries: promptBuilder.processedWorldInfo?.triggeredEntries ?? {},
    };
    promptStore.addItemizedPrompt(itemizedPrompt);

    let effectiveMessages = [...messages];
    if (postProcessing !== CustomPromptPostProcessing.NONE) {
      try {
        effectiveMessages = await processMessagesWithPrefill(effectiveMessages, postProcessing);
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

    const handleGenerationResult = async (
      content: string,
      reasoning?: string,
      tokenCount?: number,
      images?: string[],
    ) => {
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
      const token_count = tokenCount ?? (await countTokens(finalContent, tokenizer));

      // Handle generated images from both payload and inline markdown
      const mediaItems: ChatMediaItem[] = [];
      if (images && images.length > 0) {
        mediaItems.push(
          ...images.map(
            (url) =>
              ({
                source: 'url',
                type: 'image',
                url: url,
                title: 'Generated Image',
              }) as ChatMediaItem,
          ),
        );
      }
      const inlineMedia = extractMediaFromMarkdown(finalContent);
      mediaItems.push(...inlineMedia);

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
        lastMessage.extra.token_count = await countTokens(lastMessage.mes, tokenizer);

        const existingNonInline = lastMessage.extra.media?.filter((m) => m.source !== 'inline') ?? [];
        const newInline = extractMediaFromMarkdown(lastMessage.mes);
        lastMessage.extra.media = [...existingNonInline, ...newInline];
        if (lastMessage.extra.media.length === 0) delete lastMessage.extra.media;

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
        // Note: Swipes usually share 'extra' from the message object, but media might be per swipe ideally.
        // Current structure: extra is on message. Swipe info has extra too.
        if (mediaItems.length > 0) {
          if (!lastMessage.extra.media) lastMessage.extra.media = [];
          lastMessage.extra.media.push(...mediaItems);
        }

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
          extra: { reasoning, token_count, media: mediaItems.length > 0 ? mediaItems : undefined },
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

    const generationOptions = {
      signal: abortSignal,
      tokenizer: tokenizer,
      tracking: {
        source: 'core',
        model: context.settings.model,
        inputTokens: promptTotal,
        context: activeCharacter.name,
      },
      reasoningTemplate: context.settings.reasoningTemplate,
      onCompletion: (data: { outputTokens: number }) => {
        if (generatedMessage) {
          if (!generatedMessage.extra) generatedMessage.extra = {};
          generatedMessage.extra.token_count = data.outputTokens;
        }
      },
    };

    if (!payload.stream) {
      const response = (await ChatCompletionService.generate(
        payload,
        effectiveFormatter,
        generationOptions,
      )) as GenerationResponse;

      if (deps.activeChat.value !== chatContext) throw new Error('Context switched');

      const responseController = new AbortController();
      await eventEmitter.emit('process:response', response, {
        payload,
        controller: responseController,
        generationId,
      });
      if (!responseController.signal.aborted) {
        if (
          (!response.content || response.content.trim() === '') &&
          (!response.images || response.images.length === 0)
        ) {
          toast.error(t('chat.generate.emptyResponseError'));
          return null;
        }
        await handleGenerationResult(response.content, response.reasoning, response.token_count, response.images);
      }
    } else {
      // Streaming
      const streamGenerator = (await ChatCompletionService.generate(
        payload,
        effectiveFormatter,
        generationOptions,
      )) as unknown as () => AsyncGenerator<StreamedChunk>;

      let targetMessageIndex = -1;
      let messageCreated = false;
      const streamImages: string[] = [];

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

          if (chunk.images) {
            streamImages.push(...chunk.images);
          }

          // Create message on first chunk with content or images
          const hasContent = chunk.delta && chunk.delta.trim();
          const hasImages = chunk.images && chunk.images.length > 0;

          if (!messageCreated && (hasContent || hasImages)) {
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
              if (lastMessage.extra) {
                delete lastMessage.extra.display_text;
                delete lastMessage.extra.reasoning_display_text;
              }
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
            if (
              finalMessage.swipes &&
              finalMessage.swipe_id !== undefined &&
              finalMessage.swipes[finalMessage.swipe_id] !== undefined
            ) {
              finalMessage.swipes[finalMessage.swipe_id] = trimmed;
            }
          }

          finalMessage.gen_finished = new Date().toISOString();
          if (!finalMessage.extra) finalMessage.extra = {};

          const existingNonInline = finalMessage.extra.media?.filter((m) => m.source !== 'inline') ?? [];
          const inlineMedia = extractMediaFromMarkdown(finalMessage.mes);

          if (streamImages.length > 0) {
            existingNonInline.push(
              ...streamImages.map(
                (url) =>
                  ({
                    source: 'url',
                    type: 'image',
                    url: url,
                    title: 'Generated Image',
                  }) satisfies ChatMediaItem,
              ),
            );
          }

          const allMedia = [...existingNonInline, ...inlineMedia];
          finalMessage.extra.media = allMedia.length > 0 ? allMedia : undefined;
          if (!finalMessage.extra.media) delete finalMessage.extra.media;

          if (finalMessage.extra.token_count === undefined) {
            finalMessage.extra.token_count = await countTokens(finalMessage.mes, tokenizer);
          }

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
