import Handlebars from 'handlebars';
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
import { joinCharacterField } from '../utils/chat';
import { eventEmitter } from '../utils/extensions';
import { WorldInfoProcessor } from './world-info';

function sanitizeHandlebarsData(str: string): string {
  if (!str) return '';
  return str.replace(/{{/g, '\\{\\{').replace(/}}/g, '\\}\\}');
}

function substitute(text: string, chars: Character[], user: string): string {
  if (!text) return '';
  if (!text.includes('{{')) return text;

  try {
    const template = Handlebars.compile(text, { noEscape: true });
    const result = template({
      user: sanitizeHandlebarsData(user),
      char: chars.length > 0 ? sanitizeHandlebarsData(chars[0].name) : '',
      chars: chars.map((c) => sanitizeHandlebarsData(c.name)),
      description: chars.length > 0 ? chars[0].description : '',
      personality: chars.length > 0 ? chars[0].personality : '',
      scenario: chars.length > 0 ? chars[0].scenario : '',
    });
    return result;
  } catch (e) {
    console.warn('Failed to compile Handlebars template for prompt:', e);
    return text;
  }
}

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

  public getContent(fieldGetter: (char: Character) => string | undefined, singleCharContent?: string): string {
    if (this.characters.length > 1) {
      return joinCharacterField(this.characters, fieldGetter);
    }
    return singleCharContent || '';
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
            let content = '';
            if (isGroupContext) {
              content = this.getContent((c) => c.description);
            } else {
              content = this.character.description || '';
            }
            if (content) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            break;
          }
          case 'charPersonality': {
            let content = '';
            if (isGroupContext) {
              content = this.getContent((c) => c.personality);
            } else {
              content = this.character.personality || '';
            }
            if (content) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            break;
          }
          case 'scenario': {
            let content = '';
            if (this.chatMetadata.promptOverrides?.scenario) {
              content = this.chatMetadata.promptOverrides.scenario;
            } else {
              if (isGroupContext) {
                content = this.getContent((c) => c.scenario);
              } else {
                content = this.character.scenario || '';
              }
            }
            if (content) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            break;
          }
          case 'dialogueExamples': {
            let content = '';
            if (isGroupContext) {
              content = this.characters
                .map((c) => {
                  if (!c.mes_example) return null;
                  return substitute(c.mes_example, [c], this.persona.name);
                })
                .filter(Boolean)
                .join('\n\n');
            } else if (this.character.mes_example) {
              content = substitute(this.character.mes_example, [this.character], this.persona.name);
            }
            if (content) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            break;
          }
          case 'worldInfoBefore':
            if (worldInfoBefore)
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content: worldInfoBefore });
            break;
          case 'worldInfoAfter':
            if (worldInfoAfter) fixedPrompts.push({ role: promptDefinition.role ?? 'system', content: worldInfoAfter });
            break;
        }
      } else {
        if (promptDefinition.content && promptDefinition.role) {
          const content = substitute(promptDefinition.content, this.characters, this.persona.name);
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

      const apiMsg: ApiChatMessage = {
        role: msg.is_user ? 'user' : 'assistant',
        content: msg.mes,
      };

      if (!msg.is_user && (this.chatMetadata.members?.length ?? 0) > 1) {
        apiMsg.content = `${msg.name}: ${msg.mes}`;
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
