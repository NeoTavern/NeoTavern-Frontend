import { defaultSamplerSettings, GroupGenerationHandlingMode } from '../constants';
import type {
  ApiChatMessage,
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
import { eventEmitter } from '../utils/extensions';
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
  private getProcessedContent(
    fieldGetter: (char: Character) => string | undefined,
    singleCharContent?: string,
  ): string {
    // If it's a group, we iterate all characters and process their specific field with their own context
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

    // Single character case
    const raw = singleCharContent || '';
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
    const { worldInfoBefore, worldInfoAfter } = this.processedWorldInfo;

    // 2. Build non-history prompts
    const fixedPrompts: ApiChatMessage[] = [];
    const enabledPrompts = this.samplerSettings.prompts.filter((p) => p.enabled);
    if (enabledPrompts.length === 0) {
      console.warn('No enabled prompts found in sampler settings.');
      return [];
    }
    const historyPlaceholder = { role: 'system', content: '[[CHAT_HISTORY_PLACEHOLDER]]' } as const;

    const handlingMode = this.chatMetadata.group?.config?.handlingMode ?? GroupGenerationHandlingMode.SWAP;
    const isGroupContext = this.characters.length > 1 || handlingMode !== GroupGenerationHandlingMode.SWAP;

    for (const promptDefinition of enabledPrompts) {
      if (promptDefinition.marker) {
        switch (promptDefinition.identifier) {
          case 'chatHistory':
            fixedPrompts.push(historyPlaceholder);
            break;
          case 'charDescription': {
            const content = this.getProcessedContent(
              (c) => c.description,
              isGroupContext ? undefined : this.character.description,
            );
            if (content) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            break;
          }
          case 'charPersonality': {
            const content = this.getProcessedContent(
              (c) => c.personality,
              isGroupContext ? undefined : this.character.personality,
            );
            if (content) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
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
              content = this.getProcessedContent(
                (c) => c.scenario,
                isGroupContext ? undefined : this.character.scenario,
              );
            }
            if (content) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            break;
          }
          case 'dialogueExamples': {
            const content = this.getProcessedContent(
              (c) => c.mes_example,
              isGroupContext ? undefined : this.character.mes_example,
            );
            const formattedContent = content.split('\n').join('\n\n');
            if (content) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content: formattedContent });
            break;
          }
          case 'worldInfoBefore':
            // WI processor already handles macros
            if (worldInfoBefore)
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content: worldInfoBefore });
            break;
          case 'worldInfoAfter':
            if (worldInfoAfter) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content: worldInfoAfter });
            break;
          case 'personaDescription': {
            const content = macroService.process(this.persona.description || '', {
              characters: this.characters,
              persona: this.persona,
            });
            if (content) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            break;
          }
          case 'jailbreak': {
            const content = this.getProcessedContent(
              (c) => c.data?.post_history_instructions,
              isGroupContext ? undefined : this.character.data?.post_history_instructions,
            );
            if (content) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            break;
          }
        }
      } else {
        if (promptDefinition.content && promptDefinition.role) {
          const content = macroService.process(promptDefinition.content, {
            characters: this.characters,
            persona: this.persona,
          });
          if (content) fixedPrompts.push({ role: promptDefinition.role, content });
        }
      }
    }

    for (const prompt of fixedPrompts) {
      if (prompt.content !== historyPlaceholder.content) {
        currentTokenCount += await this.tokenizer.getTokenCount(prompt.content);
      }
    }

    // 3. Build chat history
    const historyBudget = this.maxContext - currentTokenCount - (this.samplerSettings.max_tokens ?? 500);
    const historyMessages: ApiChatMessage[] = [];
    let historyTokenCount = 0;

    for (let i = this.chatHistory.length - 1; i >= 0; i--) {
      const msg = this.chatHistory[i];
      if (msg.is_system) continue;

      const processedContent = macroService.process(msg.mes, {
        characters: this.characters,
        persona: this.persona,
      });

      const apiMsg: ApiChatMessage = {
        role: msg.is_user ? 'user' : 'assistant',
        content: processedContent,
        name: msg.name,
      };

      if (!msg.is_user && (this.chatMetadata.members?.length ?? 0) > 1) {
        apiMsg.content = `${msg.name}: ${processedContent}`;
      }

      const msgTokenCount = await this.tokenizer.getTokenCount(apiMsg.content);

      if (historyTokenCount + msgTokenCount <= historyBudget) {
        historyTokenCount += msgTokenCount;
        historyMessages.unshift(apiMsg);
      } else {
        break;
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
