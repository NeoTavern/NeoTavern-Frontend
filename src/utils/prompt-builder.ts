import type {
  Character,
  ChatMessage,
  Persona,
  SamplerSettings,
  ApiChatMessage,
  PromptBuilderOptions,
  Tokenizer,
  ProcessedWorldInfo,
  ChatMetadata,
} from '../types';
import { useWorldInfoStore } from '../stores/world-info.store';
import { WorldInfoProcessor } from './world-info-processor';
import { defaultSamplerSettings } from '../constants';
import { eventEmitter } from './event-emitter';
import { joinCharacterField } from './group-chat';
import Handlebars from 'handlebars';

// TODO: Add proper templating engine
function substitute(text: string, chars: Character[], user: string): string {
  if (!text) return '';
  const template = Handlebars.compile(text, { noEscape: true });
  const result = template({
    user,
    char: chars.length > 0 ? chars[0].name : '',
    chars: chars.map((c) => c.name),
    description: chars.length > 0 ? chars[0].description : '',
    personality: chars.length > 0 ? chars[0].personality : '',
    scenario: chars.length > 0 ? chars[0].scenario : '',
  });
  return result;
}

export class PromptBuilder {
  private characters: Character[];
  private character: Character;
  private chatMetadata: ChatMetadata;
  private chatHistory: ChatMessage[];
  private samplerSettings: SamplerSettings;
  private persona: Persona;
  private maxContext: number;
  private tokenizer: Tokenizer;
  public processedWorldInfo: ProcessedWorldInfo | null = null;

  constructor({ characters, chatHistory, samplerSettings, persona, tokenizer, chatMetadata }: PromptBuilderOptions) {
    this.characters = characters;
    this.character = characters[0];
    this.chatMetadata = chatMetadata;
    this.chatHistory = chatHistory;
    this.samplerSettings = samplerSettings;
    this.persona = persona;
    this.tokenizer = tokenizer;

    this.maxContext = this.samplerSettings.max_context ?? defaultSamplerSettings.max_context;
  }

  private getContent(fieldGetter: (char: Character) => string | undefined, singleCharContent?: string): string {
    if (this.characters.length > 1) {
      return joinCharacterField(this.characters, fieldGetter);
    }
    return singleCharContent || '';
  }

  public async build(): Promise<ApiChatMessage[]> {
    const options: PromptBuilderOptions = {
      characters: this.characters,
      chatMetadata: this.chatMetadata,
      chatHistory: this.chatHistory,
      samplerSettings: this.samplerSettings,
      persona: this.persona,
      tokenizer: this.tokenizer,
    };
    await eventEmitter.emit('prompt:building-started', options);
    const finalMessages: ApiChatMessage[] = [];
    let currentTokenCount = 0;

    // 1. Process World Info
    const worldInfoStore = useWorldInfoStore();
    const activeBooks = await Promise.all(
      worldInfoStore.bookNames
        .filter((name) => worldInfoStore.activeBookNames.includes(name))
        .map(async (name) => await worldInfoStore.getBookFromCache(name, true)),
    );

    const processor = new WorldInfoProcessor({
      books: activeBooks.filter((book): book is NonNullable<typeof book> => book !== null),
      chat: this.chatHistory,
      characters: this.characters,
      settings: worldInfoStore.settings,
      persona: this.persona,
      maxContext: this.maxContext,
      tokenizer: this.tokenizer,
    });

    this.processedWorldInfo = await processor.process();
    const { worldInfoBefore, worldInfoAfter } = this.processedWorldInfo;

    // 2. Build non-history prompts and count their tokens
    const fixedPrompts: ApiChatMessage[] = [];
    const promptOrderConfig = this.samplerSettings.prompt_order;
    if (!promptOrderConfig) {
      console.error('Default prompt order not found in settings.');
      return [];
    }
    const enabledPrompts = promptOrderConfig.order.filter((p) => p.enabled);
    const historyPlaceholder = { role: 'system', content: '[[CHAT_HISTORY_PLACEHOLDER]]' } as const;

    for (const promptConfig of enabledPrompts) {
      const promptDefinition = this.samplerSettings.prompts?.find((p) => p.identifier === promptConfig.identifier);
      if (!promptDefinition) continue;

      if (promptDefinition.marker) {
        switch (promptDefinition.identifier) {
          case 'chatHistory':
            fixedPrompts.push(historyPlaceholder);
            break;
          case 'charDescription': {
            const content = this.getContent((c) => c.description, this.character.description);
            if (content) {
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            }
            break;
          }
          case 'charPersonality': {
            const content = this.getContent((c) => c.personality, this.character.personality);
            if (content) {
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            }
            break;
          }
          case 'scenario': {
            let content = '';
            if (this.chatMetadata.promptOverrides?.scenario) {
              content = this.chatMetadata.promptOverrides.scenario;
            } else {
              content = this.getContent((c) => c.scenario, this.character.scenario);
            }

            if (content) {
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            }
            break;
          }
          case 'dialogueExamples': {
            // Join mode concatenates examples.
            let content = '';
            if (this.characters.length > 1) {
              // For examples, we might want to substitute {{char}} before joining to ensure names are correct per block
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

            if (content) {
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content });
            }
            break;
          }
          case 'worldInfoBefore':
            if (worldInfoBefore) {
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content: worldInfoBefore });
            }
            break;
          case 'worldInfoAfter':
            if (worldInfoAfter) {
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content: worldInfoAfter });
            }
            break;
        }
      } else {
        if (promptDefinition.content && promptDefinition.role) {
          const content = substitute(promptDefinition.content, this.characters, this.persona.name);
          if (content) {
            fixedPrompts.push({ role: promptDefinition.role, content });
          }
        }
      }
    }
    // TODO: Handle other WI positions like AT_DEPTH, EM, etc.

    for (const prompt of fixedPrompts) {
      if (prompt.content !== historyPlaceholder.content) {
        currentTokenCount += await this.tokenizer.getTokenCount(prompt.content);
      }
    }

    // 3. Build chat history within the remaining token budget
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

      // TODO: Configuration?
      if (!msg.is_user && this.chatMetadata.members.length > 1) {
        apiMsg.content = `${msg.name}: ${msg.mes}`;
      }

      const msgTokenCount = await this.tokenizer.getTokenCount(apiMsg.content);

      if (historyTokenCount + msgTokenCount <= historyBudget) {
        historyTokenCount += msgTokenCount;
        historyMessages.unshift(apiMsg);
      } else {
        break; // Stop when budget is exceeded
      }
    }

    // 4. Assemble final prompt array
    for (const prompt of fixedPrompts) {
      if (prompt.content === historyPlaceholder.content) {
        finalMessages.push(...historyMessages);
      } else {
        finalMessages.push(prompt);
      }
    }

    await eventEmitter.emit('prompt:built', finalMessages);
    return finalMessages;
  }
}
