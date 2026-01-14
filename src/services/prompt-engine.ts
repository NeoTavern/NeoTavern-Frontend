import { defaultSamplerSettings } from '../constants';
import type {
  ApiAssistantMessage,
  ApiChatMessage,
  ApiToolMessage,
  Character,
  ChatMessage,
  ChatMetadata,
  Persona,
  ProcessedWorldInfo,
  PromptBuilderOptions,
  SamplerSettings,
  Tokenizer,
  WorldInfoBook,
  WorldInfoSettings,
} from '../types';
import { countTokens, eventEmitter } from '../utils/extensions';
import { macroService } from './macro-service';
import { WorldInfoProcessor } from './world-info';

export class PromptBuilder {
  public characters: Character[];
  public character: Character;
  public chatMetadata: ChatMetadata;
  public chatHistory: ChatMessage[];
  public samplerSettings: SamplerSettings;
  public persona: Persona;
  public maxContext: number;
  public tokenizer: Tokenizer;
  public processedWorldInfo: ProcessedWorldInfo | null = null;
  public worldInfo: WorldInfoSettings;
  public books: WorldInfoBook[];
  public generationId: string;

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
  }: PromptBuilderOptions) {
    this.characters = characters;
    this.character = characters[0];
    this.chatMetadata = chatMetadata;
    this.chatHistory = chatHistory;
    this.samplerSettings = samplerSettings;
    this.persona = persona;
    this.tokenizer = tokenizer;
    this.worldInfo = worldInfo;
    this.books = books;
    this.generationId = generationId;

    this.maxContext = this.samplerSettings.max_context ?? defaultSamplerSettings.max_context;
  }

  /**
   * Helper to process a specific field for all characters in the context.
   * Replaces macros using each character as the specific 'activeCharacter' context.
   */
  private getProcessedContent(fieldGetter: (char: Character) => string | undefined): string {
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

    const isGroupContext = (this.chatMetadata.members?.length ?? 0) > 1;

    for (const promptDefinition of enabledPrompts) {
      const role = promptDefinition.role ?? 'system';
      const name =
        role === 'user'
          ? this.persona.name || 'User'
          : role === 'assistant'
            ? this.character.name || 'Character'
            : 'System';
      if (promptDefinition.marker) {
        switch (promptDefinition.identifier) {
          case 'chatHistory': {
            fixedPrompts.push(historyPlaceholder);
            break;
          }
          case 'charDescription': {
            const content = this.getProcessedContent((c) => c.description);
            if (content) fixedPrompts.push({ role, content, name });
            break;
          }
          case 'charPersonality': {
            const content = this.getProcessedContent((c) => c.personality);
            if (content) fixedPrompts.push({ role, content, name });
            break;
          }
          case 'scenario': {
            let content = '';
            if (this.chatMetadata.promptOverrides?.scenario) {
              content = macroService.process(this.chatMetadata.promptOverrides.scenario, {
                characters: this.characters,
                persona: this.persona,
              });
            } else {
              content = this.getProcessedContent((c) => c.scenario);
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

            const content = this.getProcessedContent((c) => c.mes_example);
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
            const content = this.getProcessedContent((c) => c.data?.post_history_instructions);
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

    for (const prompt of fixedPrompts) {
      if (prompt.content && prompt.content !== historyPlaceholder.content) {
        currentTokenCount += await countTokens(prompt.content, this.tokenizer);
      }
    }

    // 3. Build chat history
    const historyBudget = this.maxContext - currentTokenCount - (this.samplerSettings.max_tokens ?? 500);
    const historyMessages: ApiChatMessage[] = [];
    let historyTokenCount = 0;

    const insertMessages = async (msgs: ApiChatMessage[]): Promise<boolean> => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i];
        const tokenCount = await countTokens(msg.content, this.tokenizer);
        if (historyTokenCount + tokenCount <= historyBudget) {
          historyTokenCount += tokenCount;
          historyMessages.unshift(msg);
        } else {
          return false;
        }
      }
      return true;
    };

    const depthEntriesMap = new Map<number, ApiChatMessage[]>();
    if (this.processedWorldInfo.depthEntries.length > 0) {
      for (const entryItem of this.processedWorldInfo.depthEntries) {
        const msgs: ApiChatMessage[] = entryItem.entries.map(
          (content) =>
            ({
              role: entryItem.role,
              content,
              name: entryItem.role,
            }) as ApiChatMessage,
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

      const processedContent = macroService.process(msg.mes, {
        characters: this.characters,
        persona: this.persona,
      });

      const toolInvocations = msg.extra?.tool_invocations;

      const apiMessagesToInsert: ApiChatMessage[] = [];

      if (msg.is_user) {
        apiMessagesToInsert.push({
          role: 'user',
          content: processedContent,
          name: msg.name,
        });
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
              signature: inv.signature,
            }))
          : undefined;

        let assistantMsg: ApiAssistantMessage;
        if (tool_calls) {
          assistantMsg = {
            role: 'assistant',
            name: msg.name,
            content: processedContent || null,
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
          apiMessagesToInsert.push(assistantMsg);
        }

        if (toolInvocations) {
          const toolMessages: ApiToolMessage[] = toolInvocations.map((inv) => ({
            role: 'tool',
            tool_call_id: inv.id,
            content: inv.result,
            name: inv.name,
          }));
          apiMessagesToInsert.push(...toolMessages);
        }
      }

      await eventEmitter.emit('prompt:history-message-processing', apiMessagesToInsert, {
        originalMessage: msg,
        isGroupContext,
        characters: this.characters,
        persona: this.persona,
        index: i,
        chatLength: this.chatHistory.length,
      });

      // Insert the generated messages, checking budget for each one
      const success = await insertMessages(apiMessagesToInsert);
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
