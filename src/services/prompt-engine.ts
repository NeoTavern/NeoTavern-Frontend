import { defaultSamplerSettings } from '../constants';
import type {
  ApiAssistantMessage,
  ApiChatContentPart,
  ApiChatMessage,
  ApiToolMessage,
  Character,
  ChatMessage,
  ChatMetadata,
  MediaHydrationContext,
  Persona,
  ProcessedWorldInfo,
  PromptBuilderOptions,
  SamplerSettings,
  StructuredResponseOptions,
  StructuredResponsePrompted,
  Tokenizer,
  WorldInfoBook,
  WorldInfoSettings,
} from '../types';
import { countTokens, eventEmitter } from '../utils/extensions';
import { compressImage, getImageTokenCost, getMediaDurationFromDataURL, isDataURL } from '../utils/media';
import { buildStructuredResponseSystemPrompt } from '../utils/structured-response';
import { macroService } from './macro-service';
import { WorldInfoProcessor } from './world-info';

export class PromptBuilder {
  public characters: Character[];
  public character?: Character;
  public chatMetadata?: ChatMetadata;
  public chatHistory: ChatMessage[];
  public samplerSettings: SamplerSettings;
  public persona: Persona;
  public maxContext: number;
  public tokenizer: Tokenizer;
  public processedWorldInfo: ProcessedWorldInfo | null = null;
  public worldInfo: WorldInfoSettings;
  public books: WorldInfoBook[];
  public generationId: string;
  public mediaTokenCost = 0;
  public mediaContext: MediaHydrationContext;
  public structuredResponse?: StructuredResponseOptions;

  private static convertApiMessagesToChatMessages(apiMessages: ApiChatMessage[]): ChatMessage[] {
    return apiMessages.map((m) => ({
      extra: {},
      is_user: m.role === 'user',
      is_system: false,
      mes: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      name: m.name,
      send_date: new Date().toISOString(),
      swipe_id: 0,
      swipe_info: [],
      swipes: [],
      original_avatar: '',
    }));
  }

  constructor({
    characters,
    chatHistory,
    samplerSettings,
    persona,
    tokenizer,
    chatMetadata,
    worldInfo,
    books,
    generationId,
    mediaContext,
    structuredResponse,
  }: PromptBuilderOptions) {
    this.characters = characters;
    this.character = characters.length > 0 ? characters[0] : undefined;
    this.chatMetadata = chatMetadata;
    this.chatHistory =
      Array.isArray(chatHistory) && chatHistory.length > 0 && 'role' in chatHistory[0]
        ? PromptBuilder.convertApiMessagesToChatMessages(chatHistory as ApiChatMessage[])
        : (chatHistory as ChatMessage[]);
    this.samplerSettings = samplerSettings;
    this.persona = persona;
    this.tokenizer = tokenizer;
    this.worldInfo = worldInfo;
    this.books = books;
    this.generationId = generationId;
    this.mediaContext = mediaContext;
    this.structuredResponse = structuredResponse;

    this.maxContext = this.samplerSettings.max_context ?? defaultSamplerSettings.max_context;
  }

  /**
   * Helper to process a specific field for all characters in the context.
   * Replaces macros using each character as the specific 'activeCharacter' context.
   */
  private getProcessedContent(fieldGetter: (char?: Character) => string | undefined): string {
    // If multiple characters are in context, process all of them
    if (this.characters.length > 1) {
      return this.characters
        .map((c) => {
          const raw = fieldGetter(c);
          if (!raw) return null;
          return macroService.process(raw, {
            characters: this.characters,
            persona: this.persona,
            activeCharacter: c,
          });
        })
        .filter(Boolean)
        .join('\n');
    }

    // Single character case (Including Group Chat SWAP mode where characters.length === 1)
    const raw = fieldGetter(this.character) || '';
    if (!raw) return '';
    return macroService.process(raw, {
      characters: this.characters,
      persona: this.persona,
    });
  }

  private async _buildMessageContent(
    msg: ChatMessage,
  ): Promise<{ content: string | ApiChatContentPart[]; mediaTokens: number }> {
    const processedContent = macroService.process(msg.mes, {
      characters: this.characters,
      persona: this.persona,
    });
    let mediaTokens = 0;

    const mediaEnabled =
      this.mediaContext && this.mediaContext.formatter !== 'text' && this.mediaContext.apiSettings.sendMedia;
    if (!mediaEnabled || !msg.extra.media || msg.extra.media.length === 0) {
      return { content: processedContent, mediaTokens: 0 };
    }

    const { modelCapabilities, apiSettings } = this.mediaContext;

    const contentParts: ApiChatContentPart[] = [];
    if (processedContent) {
      contentParts.push({ type: 'text', text: processedContent });
    }

    const ignoredMedia = msg.extra.ignored_media ?? [];
    for (const mediaItem of msg.extra.media) {
      if (ignoredMedia.includes(mediaItem.url) || (mediaItem.source === 'inline' && apiSettings.forbidExternalMedia)) {
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
              detail: apiSettings.imageQuality,
            },
          });
          mediaTokens += await getImageTokenCost(compressed, apiSettings.imageQuality);
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
            mediaTokens += 263 * Math.ceil(await getMediaDurationFromDataURL(dataUrl, 'video'));
          } else {
            contentParts.push({ type: 'audio_url', audio_url: { url: dataUrl } });
            mediaTokens += 32 * Math.ceil(await getMediaDurationFromDataURL(dataUrl, 'audio'));
          }
        } else if (mediaItem.type === 'text') {
          try {
            const response = await fetch(dataUrl);
            if (response.ok) {
              const textContent = await response.text();
              contentParts.push({ type: 'text', text: textContent });
              mediaTokens += await countTokens(textContent, this.tokenizer);
            }
          } catch (e) {
            console.error('Failed to fetch text file:', e);
          }
        }
      } catch (e) {
        console.error('Failed to process media item:', e);
      }
    }
    return { content: contentParts.length > 1 ? contentParts : processedContent, mediaTokens };
  }

  public async build(): Promise<ApiChatMessage[]> {
    const options: PromptBuilderOptions = {
      books: this.books,
      characters: this.characters,
      chatMetadata: this.chatMetadata,
      chatHistory: this.chatHistory,
      samplerSettings: this.samplerSettings,
      persona: this.persona,
      tokenizer: this.tokenizer,
      worldInfo: this.worldInfo,
      generationId: this.generationId,
      mediaContext: this.mediaContext,
    };
    await eventEmitter.emit('prompt:building-started', options);
    const finalMessages: ApiChatMessage[] = [];
    let currentTokenCount = 0;

    // 1. Process World Info
    const processor = new WorldInfoProcessor({
      books: this.books,
      chat: this.chatHistory,
      characters: this.characters,
      settings: this.worldInfo,
      persona: this.persona,
      maxContext: this.maxContext,
      tokenizer: this.tokenizer,
      generationId: this.generationId,
    });

    this.processedWorldInfo = await processor.process();
    const { worldInfoBefore, worldInfoAfter, emBefore, emAfter } = this.processedWorldInfo;

    // 2. Build non-history prompts
    const fixedPrompts: ApiChatMessage[] = [];
    const enabledPrompts = this.samplerSettings.prompts.filter((p) => p.enabled);
    if (enabledPrompts.length === 0) {
      console.warn('No enabled prompts found in sampler settings.');
      return [];
    }
    const historyPlaceholder = {
      role: 'system' as const,
      content: '[[CHAT_HISTORY_PLACEHOLDER]]',
      name: 'system',
    };

    const isGroupContext = (this.chatMetadata?.members?.length ?? 0) > 1;

    for (const promptDefinition of enabledPrompts) {
      const role = promptDefinition.role ?? 'system';
      const name =
        role === 'user'
          ? this.persona.name || 'User'
          : role === 'assistant'
            ? this.character?.name || 'Character'
            : 'System';
      if (promptDefinition.marker) {
        switch (promptDefinition.identifier) {
          case 'chatHistory': {
            fixedPrompts.push(historyPlaceholder);
            break;
          }
          case 'charDescription': {
            const content = this.getProcessedContent((c) => c?.description);
            if (content) fixedPrompts.push({ role, content, name });
            break;
          }
          case 'charPersonality': {
            const content = this.getProcessedContent((c) => c?.personality);
            if (content) fixedPrompts.push({ role, content, name });
            break;
          }
          case 'scenario': {
            let content = '';
            if (this.chatMetadata?.promptOverrides?.scenario) {
              content = macroService.process(this.chatMetadata.promptOverrides.scenario, {
                characters: this.characters,
                persona: this.persona,
              });
            } else {
              content = this.getProcessedContent((c) => c?.scenario);
            }
            if (content) fixedPrompts.push({ role, content, name });
            break;
          }
          case 'dialogueExamples': {
            if (emBefore && emBefore.length > 0) {
              for (const em of emBefore) {
                fixedPrompts.push({ role, content: em, name });
              }
            }

            const content = this.getProcessedContent((c) => c?.mes_example);
            const formattedContent = content.split('\n').join('\n\n');
            if (content) fixedPrompts.push({ role, content: formattedContent, name });

            if (emAfter && emAfter.length > 0) {
              for (const em of emAfter) {
                fixedPrompts.push({ role, content: em, name });
              }
            }
            break;
          }
          case 'worldInfoBefore': {
            // WI processor already handles macros
            if (worldInfoBefore) fixedPrompts.push({ role, content: worldInfoBefore, name });
            break;
          }
          case 'worldInfoAfter': {
            if (worldInfoAfter) fixedPrompts.push({ role, content: worldInfoAfter, name });
            break;
          }
          case 'personaDescription': {
            const content = macroService.process(this.persona.description || '', {
              characters: this.characters,
              persona: this.persona,
            });
            if (content) fixedPrompts.push({ role, content, name });
            break;
          }
          case 'jailbreak': {
            const content = this.getProcessedContent((c) => c?.data?.post_history_instructions);
            if (content) fixedPrompts.push({ role, content, name });
            break;
          }
        }
      } else {
        if (promptDefinition.content && promptDefinition.role) {
          const content = macroService.process(promptDefinition.content, {
            characters: this.characters,
            persona: this.persona,
          });
          if (content) fixedPrompts.push({ role, content, name });
        }
      }
    }

    // Add structured response system prompt if needed
    if (this.structuredResponse && this.structuredResponse.format !== 'native') {
      const systemPrompt = buildStructuredResponseSystemPrompt(this.structuredResponse as StructuredResponsePrompted);
      fixedPrompts.push({
        role: 'system',
        content: systemPrompt,
        name: 'System',
      });
    }

    for (const prompt of fixedPrompts) {
      if (prompt.content && prompt.content !== historyPlaceholder.content) {
        currentTokenCount += await countTokens(prompt.content, this.tokenizer);
      }
    }

    // 3. Build chat history
    const historyBudget = this.maxContext - currentTokenCount - (this.samplerSettings.max_tokens ?? 500);
    const historyMessages: ApiChatMessage[] = [];
    let historyTokenCount = 0;

    const insertMessages = async (
      msgsWithTokens: { apiMessage: ApiChatMessage; tokens: number }[],
    ): Promise<boolean> => {
      for (let i = msgsWithTokens.length - 1; i >= 0; i--) {
        const { apiMessage, tokens } = msgsWithTokens[i];
        if (historyTokenCount + tokens <= historyBudget) {
          historyTokenCount += tokens;
          historyMessages.unshift(apiMessage);
        } else {
          return false;
        }
      }
      return true;
    };

    const depthEntriesMap = new Map<number, { apiMessage: ApiChatMessage; tokens: number }[]>();
    if (this.processedWorldInfo.depthEntries.length > 0) {
      for (const entryItem of this.processedWorldInfo.depthEntries) {
        const msgs = await Promise.all(
          entryItem.entries.map(async (content) => {
            const apiMessage = {
              role: entryItem.role,
              content,
              name: entryItem.role,
            } as ApiChatMessage;
            const tokens = await countTokens(content, this.tokenizer);
            return { apiMessage, tokens };
          }),
        );

        const list = depthEntriesMap.get(entryItem.depth) || [];
        depthEntriesMap.set(entryItem.depth, [...list, ...msgs]);
      }
    }

    // Current depth counter (starts at 0 = end of chat)
    let currentDepth = 0;

    // Process Depth 0 (At the very end of history)
    if (depthEntriesMap.has(0)) {
      const msgs = depthEntriesMap.get(0)!;
      await insertMessages(msgs);
    }

    for (let i = this.chatHistory.length - 1; i >= 0; i--) {
      const msg = this.chatHistory[i];
      if (msg.is_system) {
        continue;
      }

      const { content: processedContent, mediaTokens } = await this._buildMessageContent(msg);
      if (mediaTokens > 0) this.mediaTokenCost += mediaTokens;

      const toolInvocations = msg.extra.tool_invocations;

      const messagesToInsert: { apiMessage: ApiChatMessage; tokens: number }[] = [];

      if (msg.is_user) {
        const apiMessage: ApiChatMessage = {
          role: 'user',
          content: processedContent,
          name: msg.name,
        };
        const textTokens = await countTokens(processedContent, this.tokenizer);
        messagesToInsert.push({ apiMessage, tokens: textTokens + mediaTokens });
      } else {
        // This is an assistant message. It might have text, tool calls, or both.
        const tool_calls = toolInvocations
          ? toolInvocations.map((inv) => ({
              id: inv.id,
              type: 'function' as const,
              function: {
                name: inv.name,
                arguments: inv.parameters,
              },
              signature: inv.signature, // TODO: We should get via condition. It is gemini 3.0+ specific.
            }))
          : undefined;

        let assistantMsg: ApiAssistantMessage;
        const textContent = typeof processedContent === 'string' ? processedContent : null;

        if (tool_calls) {
          assistantMsg = {
            role: 'assistant',
            name: msg.name,
            content: textContent,
            tool_calls,
          };
          if (!assistantMsg.content) {
            assistantMsg.content = null;
          }
        } else {
          assistantMsg = {
            role: 'assistant',
            name: msg.name,
            content: processedContent,
          };
        }

        // Only add assistant message if it has content or tool calls
        if (assistantMsg.content || (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0)) {
          const textTokens = await countTokens(assistantMsg.content, this.tokenizer);
          messagesToInsert.push({ apiMessage: assistantMsg, tokens: textTokens + mediaTokens });
        }

        if (toolInvocations) {
          for (const inv of toolInvocations) {
            const toolMessage: ApiToolMessage = {
              role: 'tool',
              tool_call_id: inv.id,
              content: inv.result,
              name: inv.name,
            };
            const toolTokens = await countTokens(toolMessage.content, this.tokenizer);
            messagesToInsert.push({ apiMessage: toolMessage, tokens: toolTokens });
          }
        }
      }

      const eventPayload = { apiMessages: messagesToInsert.map((m) => m.apiMessage) };
      await eventEmitter.emit('prompt:history-message-processing', eventPayload, {
        originalMessage: msg,
        isGroupContext,
        characters: this.characters,
        persona: this.persona,
        index: i,
        chatLength: this.chatHistory.length,
        generationId: this.generationId,
      });

      // Re-process messages after extensions have had a chance to modify them.
      const finalMessagesToInsert = await Promise.all(
        eventPayload.apiMessages.map(async (apiMessage) => {
          // Find original message to reuse token count if it exists
          const original = messagesToInsert.find((m) => m.apiMessage === apiMessage);
          if (original) {
            return original;
          }
          // Otherwise, calculate tokens for new messages added by extensions
          const tokens = await countTokens(apiMessage.content, this.tokenizer);
          return { apiMessage, tokens };
        }),
      );

      // Insert the generated messages, checking budget for each one
      const success = await insertMessages(finalMessagesToInsert);
      if (!success) {
        break;
      }

      currentDepth++;

      // Inject depth entries for next depth
      if (depthEntriesMap.has(currentDepth)) {
        const msgs = depthEntriesMap.get(currentDepth)!;
        const success = await insertMessages(msgs);
        if (!success) {
          break;
        }
      }
    }

    // 4. Assemble final
    for (const prompt of fixedPrompts) {
      if (prompt.content === historyPlaceholder.content) {
        finalMessages.push(...historyMessages);
      } else {
        finalMessages.push(prompt);
      }
    }

    await eventEmitter.emit('prompt:built', finalMessages, { generationId: this.generationId });
    return finalMessages;
  }
}
