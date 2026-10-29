import { cloneDeep, escapeRegExp } from 'lodash-es';
import { computed, nextTick, ref, type Ref } from 'vue';
import {
  buildChatCompletionPayload,
  ChatCompletionService,
  endsWithPrefillColon,
  processMessagesWithPrefill,
  resolveConnectionProfileSettings,
} from '../api/generation';
import { getModelCapabilities } from '../api/provider-definitions';
import { ApiTokenizer } from '../api/tokenizer';
import { CustomPromptPostProcessing, default_user_avatar, GenerationMode } from '../constants';
import { runAfterGeneration, runAfterUserMessage, runBeforeGeneration } from '../services/chat-lifecycle';
import { PromptBuilder } from '../services/prompt-engine';
import { ToolService } from '../services/tool.service';
import { useApiStore } from '../stores/api.store';
import { useCharacterStore } from '../stores/character.store';
import { usePersonaStore } from '../stores/persona.store';
import { usePromptStore } from '../stores/prompt.store';
import { useSettingsStore } from '../stores/settings.store';
import { useWorldInfoStore } from '../stores/world-info.store';
import {
  type ApiChatToolCall,
  type Character,
  type ChatMediaItem,
  type ChatMessage,
  type ChatMetadata,
  type GenerationContext,
  type GenerationPayloadBuilderConfig,
  type GenerationResponse,
  type ItemizedPrompt,
  type PromptInjection,
  type StreamedChunk,
  type SwipeInfo,
  type WorldInfoBook,
} from '../types';
import { getCharactersInMemberOrder, getThumbnailUrl } from '../utils/character';
import {
  extractMediaFromMarkdown,
  refreshMessageMedia,
  setActiveSwipeText,
  toGeneratedImageMedia,
} from '../utils/chat';
import { getMessageTimeStamp, uuidv4 } from '../utils/commons';
import { eventEmitter } from '../utils/event-emitter';
import { computePromptTokenBreakdown, countTokens } from '../utils/token-count';
import { trimInstructResponse } from '../utils/instruct';
import { useStrictI18n } from './useStrictI18n';
import { toast } from './useToast';

export interface ChatStateRef {
  messages: ChatMessage[];
  metadata: ChatMetadata;
  fileName?: string;
}

export interface ChatGenerationDependencies {
  activeChat: Ref<ChatStateRef | null>;
  syncSwipeToMes: (msgIndex: number, swipeIndex: number) => Promise<void>;
  stopAutoModeTimer: () => void;
  findToolChainStart: (endIndex: number) => number;
  triggerSave: () => void;
  persistChat: (chatContext: ChatStateRef, chatFile: string) => Promise<void>;
  updateMessageTokenCountLater: (messageIndex: number, contentSnapshot: string) => void;
}

interface GenerationStepResult {
  message: ChatMessage | null;
  response: GenerationResponse;
  includedPromptInjectionIds: readonly string[];
}

const MAX_TOOL_CALL_RECURSION = 5;

export function useChatGeneration(deps: ChatGenerationDependencies) {
  const { t } = useStrictI18n();

  // Internal state for actual generation
  const _isGenerating = ref(false);
  const isGenerating = computed(() => _isGenerating.value);

  const generationController = ref<AbortController | null>(null);
  const currentGenerationId = ref<string | null>(null);

  const characterStore = useCharacterStore();
  const apiStore = useApiStore();
  const settingsStore = useSettingsStore();
  const promptStore = usePromptStore();
  const personaStore = usePersonaStore();
  const worldInfoStore = useWorldInfoStore();

  function abortGeneration() {
    generationController.value?.abort();
    _isGenerating.value = false;
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
    const trimmedMessage = messageText.trim();

    const userMessage: ChatMessage = {
      name: personaStore.activePersona.name || 'User',
      is_user: true,
      mes: trimmedMessage,
      send_date: getMessageTimeStamp(),
      force_avatar: getThumbnailUrl('persona', personaStore.activePersona.avatarId || default_user_avatar),
      original_avatar: personaStore.activePersona.avatarId,
      is_system: false,
      extra: {
        media: allMedia.length > 0 ? allMedia : undefined,
      },
      swipe_id: 0,
      swipes: [trimmedMessage],
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

    const messageIndex = currentChatContext.messages.length;
    currentChatContext.messages.push(userMessage);
    await runAfterUserMessage({
      chatFile: currentChatContext.fileName,
      messages: currentChatContext.messages,
      metadata: currentChatContext.metadata,
      message: userMessage,
      messageIndex,
      signal: createController.signal,
    });
    await nextTick();
    await eventEmitter.emit('message:created', userMessage);
    deps.updateMessageTokenCountLater(messageIndex, trimmedMessage);

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

    if (!deps.activeChat.value) {
      console.error('Attempted to generate response without an active chat.');
      return;
    }

    let mode = initialMode;
    const currentChatContext = deps.activeChat.value;
    const currentChatFile = currentChatContext.fileName;
    let historyForGen = [...currentChatContext.messages];

    // Handle Regenerate Logic (part 1: determine mode and speaker)
    if (mode === GenerationMode.REGENERATE) {
      const lastMsg = historyForGen[historyForGen.length - 1];
      if (lastMsg) {
        if (lastMsg.is_user) {
          mode = GenerationMode.NEW;
        } else {
          forceSpeakerAvatar = forceSpeakerAvatar ?? lastMsg.original_avatar;
        }
      }
    } else if (mode === GenerationMode.ADD_SWIPE || mode === GenerationMode.CONTINUE) {
      const lastMsg = historyForGen[historyForGen.length - 1];
      if (!lastMsg || lastMsg.is_user) return;
      forceSpeakerAvatar = forceSpeakerAvatar ?? lastMsg.original_avatar;
    }

    const finalGenerationId = generationId || uuidv4();
    currentGenerationId.value = finalGenerationId;

    // Create a controller for the entire generation process (including prep/orchestration)
    const overallController = new AbortController();
    generationController.value = overallController;

    let finalMessage: ChatMessage | null = null;
    let generationError: Error | undefined;
    let terminalEmitted = false;
    const finalizeGeneration = async (): Promise<void> => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      _isGenerating.value = false;
      if (generationController.value === overallController) generationController.value = null;
      if (currentGenerationId.value === finalGenerationId) currentGenerationId.value = null;
      await nextTick();
      if (overallController.signal.aborted) {
        await eventEmitter.emit('generation:aborted', { generationId: finalGenerationId });
      } else {
        await eventEmitter.emit(
          'generation:finished',
          { message: finalMessage, error: generationError },
          { generationId: finalGenerationId, mode },
        );
      }
    };

    const generationPayload = {
      mode: initialMode,
      generationId: finalGenerationId,
      handled: false,
    };
    await eventEmitter.emit('chat:generation-requested', generationPayload, { controller: overallController });

    if (overallController.signal.aborted) {
      await finalizeGeneration();
      return;
    }

    if (generationPayload.handled) {
      // Extension handled the generation request before the lifecycle generation began.
      if (generationController.value === overallController) generationController.value = null;
      if (currentGenerationId.value === finalGenerationId) currentGenerationId.value = null;
      return;
    }

    const generationTarget = (() => {
      const target = currentChatContext.messages[currentChatContext.messages.length - 1];
      if (mode === GenerationMode.NEW) return { messageIndex: currentChatContext.messages.length };
      if (mode === GenerationMode.REGENERATE && target && !target.is_user) {
        return { message: target, messageIndex: currentChatContext.messages.length - 1, swipeId: target.swipe_id ?? 0 };
      }
      if (mode === GenerationMode.ADD_SWIPE && target && !target.is_user) {
        return {
          message: target,
          messageIndex: currentChatContext.messages.length - 1,
          swipeId: Array.isArray(target.swipes) ? target.swipes.length : 1,
        };
      }
      return undefined;
    })();
    const promptInjections: PromptInjection[] = [];
    let beforeResult;
    try {
      beforeResult = [GenerationMode.NEW, GenerationMode.REGENERATE, GenerationMode.ADD_SWIPE].includes(mode)
        ? await runBeforeGeneration({
            chatFile: currentChatFile,
            generationId: finalGenerationId,
            generationMode: mode,
            messages: currentChatContext.messages,
            metadata: currentChatContext.metadata,
            history: [...currentChatContext.messages],
            ...(generationTarget ? { target: generationTarget } : {}),
            promptInjections,
            signal: overallController.signal,
          })
        : undefined;
      overallController.signal.throwIfAborted();
    } catch (error) {
      generationError = error instanceof Error && error.name !== 'AbortError' ? error : undefined;
      if (generationError) {
        console.error('Generation Error:', generationError);
        toast.error(generationError.message || t('chat.generate.errorFallback'));
      }
      await finalizeGeneration();
      return;
    }
    historyForGen = [...currentChatContext.messages];

    // Handle Regenerate Logic (part 2: delete messages if not handled)
    if (initialMode === GenerationMode.REGENERATE) {
      const lastMsg = historyForGen[historyForGen.length - 1];
      if (lastMsg && !lastMsg.is_user) {
        // Find the start of the tool chain (if merged tool messages is enabled)
        const lastIndex = historyForGen.length - 1;
        const chainStartIndex = deps.findToolChainStart(lastIndex);
        const deleteCount = lastIndex - chainStartIndex + 1;

        // Remove the entire tool chain from history
        historyForGen.splice(chainStartIndex, deleteCount);
        currentChatContext.messages.splice(chainStartIndex, deleteCount);
      }
    }

    let finalIncludedPromptInjectionIds: readonly string[] = [];

    try {
      let activeCharacter: Character | undefined;

      if (forceSpeakerAvatar) {
        activeCharacter = characterStore.activeCharacters.find((c) => c.avatar === forceSpeakerAvatar);
      } else {
        activeCharacter = characterStore.activeCharacters[0];
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
        mode,
        activeCharacter,
      });
      if (startController.signal.aborted) return;
      if (overallController.signal.aborted) return;

      // --- Tool Calling Loop ---
      let recursionDepth = 0;
      let modeForLoop = mode;

      while (recursionDepth < MAX_TOOL_CALL_RECURSION) {
        recursionDepth++;

        const stepResult = await _generationStep(
          activeCharacter,
          modeForLoop,
          finalGenerationId,
          currentChatContext,
          currentChatFile,
          historyForGen,
          overallController,
          promptInjections,
          beforeResult?.assistantContent,
        );

        if (!stepResult || overallController.signal.aborted) {
          finalMessage = null;
          break;
        }

        finalMessage = stepResult.message;
        finalIncludedPromptInjectionIds =
          beforeResult?.assistantContent === undefined
            ? stepResult.includedPromptInjectionIds
            : (beforeResult.includedPromptInjectionIds ?? []);
        const toolCalls = stepResult.response.tool_calls;

        if (toolCalls && toolCalls.length > 0) {
          toast.info(t('chat.generate.usingTools'));
          const { invocations, errors } = await ToolService.processToolCalls(toolCalls);

          // Create a system message to show results to the user
          if (invocations.length > 0 || errors.length > 0) {
            const resultMessages = invocations.map(
              (inv) => `**Tool Used: ${inv.displayName}**\n**Result:**\n\`\`\`\n${inv.result}\n\`\`\``,
            );
            const errorMessages = errors.map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (err) => `**Tool Error: ${(err as any).cause ?? 'Unknown Tool'}**\n\`\`\`\n${err.message}\n\`\`\``,
            );
            const finalContent = [...resultMessages, ...errorMessages].join('\n\n---\n\n');

            const toolResultMessage: ChatMessage = {
              name: 'System',
              is_user: false,
              is_system: true,
              mes: finalContent,
              send_date: getMessageTimeStamp(),
              original_avatar: 'system',
              force_avatar: 'favicon.ico',
              swipes: [finalContent],
              swipe_id: 0,
              swipe_info: [{ send_date: getMessageTimeStamp(), extra: {} }],
              extra: { isSmallSys: true },
            };
            currentChatContext.messages.push(toolResultMessage);
            await nextTick();
            await eventEmitter.emit('message:created', toolResultMessage);
          }

          if (errors.length > 0) {
            toast.error(t('chat.generate.toolError', { error: errors[0].message }));
          }

          // Update the assistant message that made the call with the results
          if (finalMessage) {
            if (!finalMessage.extra) finalMessage.extra = {};
            finalMessage.extra.tool_invocations = invocations;

            // Update history for the next iteration
            historyForGen = [...currentChatContext.messages];
            modeForLoop = GenerationMode.NEW; // Subsequent calls are not regens/swipes
            continue; // Continue the loop to get the final response
          }
        }

        // No tool calls, so we are done
        break;
      }

      if (recursionDepth >= MAX_TOOL_CALL_RECURSION) {
        toast.warning(t('chat.generate.maxRecursionError'));
      }

      if (
        finalMessage &&
        generationTarget &&
        [GenerationMode.NEW, GenerationMode.REGENERATE, GenerationMode.ADD_SWIPE].includes(mode)
      ) {
        await runAfterGeneration({
          chatFile: currentChatFile,
          generationId: finalGenerationId,
          generationMode: mode,
          messages: currentChatContext.messages,
          metadata: currentChatContext.metadata,
          history: [...currentChatContext.messages],
          target: {
            message: finalMessage,
            messageIndex: currentChatContext.messages.indexOf(finalMessage),
            swipeId: finalMessage.swipe_id ?? 0,
          },
          message: finalMessage,
          includedPromptInjectionIds: finalIncludedPromptInjectionIds,
          signal: overallController.signal,
        });
      }
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
      await finalizeGeneration();
    }
  }

  async function _generationStep(
    activeCharacter: Character,
    mode: GenerationMode,
    generationId: string,
    chatContext: ChatStateRef,
    chatFile: string | undefined,
    historyForStep: ChatMessage[],
    controller: AbortController,
    promptInjections: PromptInjection[],
    assistantContent?: string,
  ): Promise<GenerationStepResult | null> {
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
      samplerPresetName: effectiveSamplerPresetName,
      samplerSettings: effectiveSamplerSettings,
      formatter: effectiveFormatter,
      instructTemplate: effectiveTemplate,
      reasoningTemplate: effectiveReasoningTemplate,
      providerSpecific: effectiveProviderSpecific,
      customPromptPostProcessing: effectivePostProcessing,
    } = await resolveConnectionProfileSettings({
      profile: chatMetadata.connection_profile,
    });

    if (!effectiveModel) throw new Error(t('chat.generate.noModelError'));

    const tokenizer = new ApiTokenizer({ tokenizerType: settings.api.tokenizer, model: effectiveModel });

    // Event-driven Context Resolution
    const contextCharactersWrapper = { characters: [JSON.parse(JSON.stringify(activeCharacter))] as Character[] };
    await eventEmitter.emit('generation:resolve-context', contextCharactersWrapper, { generationId });
    const charactersForContext = contextCharactersWrapper.characters;

    const clonedSampler = cloneDeep(effectiveSamplerSettings);

    const context: GenerationContext = {
      generationId,
      mode,
      characters: charactersForContext,
      group: getCharactersInMemberOrder(characterStore.characters, chatMetadata.members),
      chatMetadata: chatMetadata,
      history: [...historyForStep],
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
      playerName: personaStore.activePersona?.name || 'User',
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

    const namePrefixRegex = new RegExp(`^\\s*${escapeRegExp(activeCharacter.name)}\\s*:\\s*`, 'i');

    /** True when a line starts with "Name:" for a speaker other than the active character. */
    const isHijackLine = (line: string): boolean => {
      const match = line.match(/^\s*(.{1,50}?):\s/);
      return !!match && stopNames.has(match[1].trim());
    };

    /** Strips the speaker's own name prefix and, for text completion, the instruct template wrapping. */
    const finalizeAssistantText = (text: string): string => {
      const trimmed = text.replace(namePrefixRegex, '');
      return context.settings.formatter === 'text' && context.settings.instructTemplate
        ? trimInstructResponse(trimmed, context.settings.instructTemplate)
        : trimmed;
    };
    if (assistantContent !== undefined) {
      const response: GenerationResponse = { content: assistantContent };
      await handleGenerationResult(assistantContent);
      return { message: generatedMessage, response, includedPromptInjectionIds: [] };
    }

    const modelCapabilities = getModelCapabilities(effectiveProvider, effectiveModel, apiStore.modelList);
    const promptBuilder = new PromptBuilder({
      generationId,
      characters: context.characters,
      group: context.group,
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
      mediaContext: {
        apiSettings: {
          sendMedia: settings.api.sendMedia,
          imageQuality: settings.api.imageQuality,
          forbidExternalMedia: settings.ui.chat.forbidExternalMedia,
        },
        modelCapabilities: modelCapabilities,
        formatter: effectiveFormatter,
      },
      structuredResponse: context.structuredResponse,
      promptInjections,
    });

    if (deps.activeChat.value !== chatContext) throw new Error('Context switched');

    const messages = await promptBuilder.build();
    if (messages.length === 0) throw new Error(t('chat.generate.noPrompts'));
    if (promptBuilder.macroVariablesChanged && chatFile) await deps.persistChat(chatContext, chatFile);
    if (deps.activeChat.value !== chatContext) throw new Error('Context switched');

    // Handle (Continue) injection
    const lastPromptMsg = messages[messages.length - 1];
    let isLastMsgPrefill = false;
    if (lastPromptMsg && lastPromptMsg.role === 'assistant') {
      isLastMsgPrefill = endsWithPrefillColon(lastPromptMsg);
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

    const breakdown = await computePromptTokenBreakdown({
      messages,
      tokenizer,
      mediaTokenCost: promptBuilder.mediaTokenCost,
      processedWorldInfo: promptBuilder.processedWorldInfo,
      character: activeCharacter,
      persona: activePersona,
      maxContext: context.settings.sampler.max_context,
      maxTokens: context.settings.sampler.max_tokens,
    });

    let swipeId = 0;
    if (mode === GenerationMode.ADD_SWIPE) {
      const lastMsg = activeChatMessages[activeChatMessages.length - 1];
      swipeId = Array.isArray(lastMsg?.swipes) ? lastMsg.swipes.length : 1;
    } else if (mode === GenerationMode.CONTINUE) {
      const lastMsg = activeChatMessages[activeChatMessages.length - 1];
      swipeId = lastMsg?.swipe_id ?? 0;
    }

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
      customPromptPostProcessing: postProcessing,
      toolConfig: {
        includeRegisteredTools: true,
      },
      mode: mode,
      structuredResponse: context.structuredResponse,
    };

    const payloadController = new AbortController();
    await eventEmitter.emit('generation:build-payload', payloadRaw, {
      controller: payloadController,
      generationId,
    });
    if (payloadController.signal.aborted) return null;

    const itemizedPrompt: ItemizedPrompt = {
      generationId,
      messageIndex: [GenerationMode.CONTINUE, GenerationMode.ADD_SWIPE].includes(mode)
        ? activeChatMessages.length - 1
        : activeChatMessages.length,
      swipeId,
      model: payloadRaw.model,
      api: payloadRaw.provider,
      tokenizer: settings.api.tokenizer,
      presetName: effectiveSamplerPresetName,
      messages: messages,
      breakdown: breakdown,
      timestamp: Date.now(),
      worldInfoEntries: promptBuilder.processedWorldInfo?.triggeredEntries ?? {},
    };
    promptStore.addItemizedPrompt(itemizedPrompt);

    const payload = buildChatCompletionPayload(payloadRaw);

    const requestPayloadController = new AbortController();
    await eventEmitter.emit('process:request-payload', payload, {
      controller: requestPayloadController,
      generationId,
    });
    if (requestPayloadController.signal.aborted) return null;

    // --- Generation Execution ---
    async function handleGenerationResult(
      content: string,
      reasoning?: string,
      tokenCount?: number,
      images?: string[],
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _tool_calls?: ApiChatToolCall[],
    ) {
      if (deps.activeChat.value !== chatContext) {
        console.warn('Chat context changed during generation. Result ignored.');
        return;
      }

      let finalContent = content;
      if (shouldCheckHijack) {
        const lines = finalContent.split('\n');
        const cutoffIndex = lines.findIndex(isHijackLine);
        if (cutoffIndex !== -1) finalContent = lines.slice(0, cutoffIndex).join('\n');
      }
      finalContent = finalizeAssistantText(finalContent);

      const genFinished = new Date().toISOString();
      const token_count = tokenCount ?? (await countTokens(finalContent, tokenizer));

      // Handle generated images from both payload and inline markdown
      const mediaItems: ChatMediaItem[] = [
        ...toGeneratedImageMedia(images ?? []),
        ...extractMediaFromMarkdown(finalContent),
      ];

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
        refreshMessageMedia(lastMessage);
        setActiveSwipeText(lastMessage, lastMessage.mes);
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
        if (createController.signal.aborted) return;

        activeChatMessages.push(botMessage);
        generatedMessage = botMessage;
        await nextTick();
        await eventEmitter.emit('message:created', botMessage);
      }
    }

    const generationOptions = {
      signal: abortSignal,
      tokenizer: tokenizer,
      tracking: {
        source: 'core',
        model: context.settings.model,
        inputTokens: breakdown.promptTotal,
        context: activeCharacter.name,
      },
      reasoningTemplate: context.settings.reasoningTemplate,
      isContinuation: mode === GenerationMode.CONTINUE || isLastMsgPrefill,
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
          (!response.images || response.images.length === 0) &&
          (!response.tool_calls || response.tool_calls.length === 0)
        ) {
          toast.error(t('chat.generate.emptyResponseError'));
          return null;
        }
        await handleGenerationResult(
          response.content,
          response.reasoning,
          response.token_count,
          response.images,
          response.tool_calls,
        );
        return {
          message: generatedMessage,
          response,
          includedPromptInjectionIds: promptBuilder.includedPromptInjectionIds,
        };
      }
    } else {
      // Streaming
      const streamGenerator = (await ChatCompletionService.generate(
        payload,
        effectiveFormatter,
        generationOptions,
      )) as AsyncGenerator<StreamedChunk>;

      let targetMessageIndex = -1;
      let messageCreated = false;
      const streamImages: string[] = [];
      let finalToolCalls: ApiChatToolCall[] | undefined;
      let fullResponseContent = '';
      let finalReasoning: string | undefined;
      let isFirstChunk = true;
      let firstStreamResponseAt: number | undefined;
      let streamResponse: GenerationResponse | null = null;
      let streamShouldReturnNull = false;

      // For CONTINUE mode, we work on existing message
      const isContinuation = mode === GenerationMode.CONTINUE || isLastMsgPrefill;
      if (mode === GenerationMode.CONTINUE) {
        targetMessageIndex = activeChatMessages.length - 1;
        messageCreated = true;
      }

      try {
        for await (const chunk of streamGenerator) {
          firstStreamResponseAt ??= Date.now();

          const chunkController = new AbortController();
          await eventEmitter.emit('process:stream-chunk', chunk, {
            payload,
            controller: chunkController,
            generationId,
          });
          if (chunkController.signal.aborted) {
            // An extension cancellation aborts the whole generation and retains aborted terminal semantics.
            controller.abort();
            break;
          }

          if (chunk.images) streamImages.push(...chunk.images);
          if (chunk.tool_calls) finalToolCalls = chunk.tool_calls;
          if (chunk.reasoning) finalReasoning = chunk.reasoning;
          fullResponseContent += chunk.delta;

          // Create message on first chunk with content, reasoning, or images
          // For continuation/prefill, preserve leading whitespace on first chunk
          const hasContent = chunk.delta && (isContinuation && isFirstChunk ? chunk.delta : chunk.delta.trim());
          const hasImages = chunk.images && chunk.images.length > 0;
          const hasReasoning = chunk.reasoning && chunk.reasoning.trim();
          const hasToolCalls = chunk.tool_calls && chunk.tool_calls.length > 0;

          if (hasContent) isFirstChunk = false;

          if (!messageCreated && (hasContent || hasImages || hasToolCalls || hasReasoning)) {
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
              if (createController.signal.aborted) {
                streamShouldReturnNull = true;
                break;
              }

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
              generatedMessage = lastMessage;
              if (!lastMessage.extra) lastMessage.extra = {};
              delete lastMessage.extra.token_count;
              delete lastMessage.extra.tokens_per_second;
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
            setActiveSwipeText(targetMessage, targetMessage.mes);
          }
          if (chunk.reasoning && chunk.reasoning !== targetMessage.extra.reasoning)
            targetMessage.extra.reasoning = chunk.reasoning;

          // Check for name hijacking/hallucinations (Stream)
          if (shouldCheckHijack) {
            const lastNewLine = targetMessage.mes.lastIndexOf('\n');
            const currentLine = lastNewLine === -1 ? targetMessage.mes : targetMessage.mes.slice(lastNewLine + 1);
            if (isHijackLine(currentLine)) {
              // This is a successful internal stop, not a user/extension cancellation. Breaking the
              // async iteration closes the stream while preserving normal accepted-message finalization.
              const contentToKeep = lastNewLine === -1 ? '' : targetMessage.mes.slice(0, lastNewLine);
              targetMessage.mes = contentToKeep;
              setActiveSwipeText(targetMessage, contentToKeep);
              break;
            }
          }
        }
      } finally {
        // Check if we never created a message (empty response)
        if (!messageCreated) {
          if (!finalToolCalls || finalToolCalls.length === 0) {
            toast.error(t('chat.generate.emptyResponseError'));
            streamShouldReturnNull = true;
          } else {
            // If there are only tool calls, we still need to create an empty message to attach them to
            await handleGenerationResult('');
          }
        }

        // Finalize streaming
        const finalMessage = activeChatMessages[targetMessageIndex];
        if (finalMessage) {
          generatedMessage = finalMessage;

          const trimmed = finalizeAssistantText(finalMessage.mes);
          finalMessage.mes = trimmed;
          setActiveSwipeText(finalMessage, trimmed);

          finalMessage.gen_finished = new Date().toISOString();
          refreshMessageMedia(finalMessage, toGeneratedImageMedia(streamImages));

          if (finalMessage.extra.token_count === undefined) {
            finalMessage.extra.token_count = await countTokens(finalMessage.mes, tokenizer);
          }
          if (firstStreamResponseAt !== undefined) {
            const elapsedSeconds = (Date.parse(finalMessage.gen_finished) - firstStreamResponseAt) / 1000;
            if (elapsedSeconds > 0) {
              finalMessage.extra.tokens_per_second = finalMessage.extra.token_count / elapsedSeconds;
            }
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
            await nextTick();
            await eventEmitter.emit('message:updated', targetMessageIndex, finalMessage);
            await eventEmitter.emit('message:swipe-changed', targetMessageIndex, finalMessage.swipe_id ?? 0);
          }
        }
        streamResponse = {
          content: fullResponseContent,
          tool_calls: finalToolCalls,
          reasoning: finalReasoning,
          images: streamImages.length > 0 ? streamImages : undefined,
        };
      }
      if (streamShouldReturnNull || !streamResponse) return null;
      return {
        message: generatedMessage,
        response: streamResponse,
        includedPromptInjectionIds: promptBuilder.includedPromptInjectionIds,
      };
    }
    return null;
  }

  return {
    isGenerating,
    generateResponse,
    sendMessage,
    abortGeneration,
    setGeneratingState: (generating: boolean) => {
      _isGenerating.value = generating;
    },
  };
}
