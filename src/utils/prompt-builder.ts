import type { Character, ChatMessage, SamplerSettings } from '../types';
import type { ApiChatMessage } from '../api/generation';
import { useWorldInfoStore } from '../stores/world-info.store';
import { WorldInfoProcessor } from './world-info-processor';
import { defaultSamplerSettings } from '../constants';

// TODO: Replace with a real API call to the backend for accurate tokenization
async function getTokenCount(text: string): Promise<number> {
  if (!text || typeof text !== 'string') return 0;
  // This is a very rough approximation. The backend will have a proper tokenizer.
  return Math.round(text.length / 4);
}

// TODO: Add proper templating engine
function substitute(text: string, char: Character, user: string): string {
  if (!text) return '';
  return text.replace(/{{char}}/g, char.name).replace(/{{user}}/g, user);
}

export type PromtBuilderOptions = {
  character: Character;
  chatHistory: ChatMessage[];
  samplerSettings: SamplerSettings;
  playerName: string;
  forContinue?: boolean;
};

export class PromptBuilder {
  private character: Character;
  private chatHistory: ChatMessage[];
  private samplerSettings: SamplerSettings;
  private playerName: string;
  private maxContext: number;
  private forContinue: boolean;

  constructor({ character, chatHistory, samplerSettings, playerName, forContinue = false }: PromtBuilderOptions) {
    this.character = character;
    this.chatHistory = chatHistory;
    this.samplerSettings = samplerSettings;
    this.playerName = playerName;
    this.forContinue = forContinue;

    this.maxContext = this.samplerSettings.max_context ?? defaultSamplerSettings.max_context;
  }

  public async build(): Promise<ApiChatMessage[]> {
    const finalMessages: ApiChatMessage[] = [];
    let currentTokenCount = 0;

    // 1. Process World Info
    const worldInfoStore = useWorldInfoStore();
    const activeBooks = worldInfoStore.bookNames
      .filter((name) => worldInfoStore.activeBookNames.includes(name))
      .map((name) => worldInfoStore.getBookFromCache(name));

    const processor = new WorldInfoProcessor({
      books: activeBooks.filter((book): book is NonNullable<typeof book> => book !== null),
      chat: this.chatHistory,
      character: this.character,
      settings: worldInfoStore.settings,
      playerName: this.playerName,
      maxContext: this.maxContext,
    });
    const { worldInfoBefore, worldInfoAfter } = await processor.process();

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
          case 'charDescription':
            if (this.character.description) {
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content: this.character.description });
            }
            break;
          case 'charPersonality':
            if (this.character.personality) {
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content: this.character.personality });
            }
            break;
          case 'scenario':
            if (this.character.scenario) {
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content: this.character.scenario });
            }
            break;
          case 'dialogueExamples':
            if (this.character.mes_example) {
              const example = substitute(this.character.mes_example, this.character, this.playerName);
              fixedPrompts.push({ role: promptDefinition.role ?? 'system', content: example });
            }
            break;
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
          const content = substitute(promptDefinition.content, this.character, this.playerName);
          if (content) {
            fixedPrompts.push({ role: promptDefinition.role, content });
          }
        }
      }
    }
    // TODO: Handle other WI positions like AT_DEPTH, EM, etc.

    for (const prompt of fixedPrompts) {
      if (prompt.content !== historyPlaceholder.content) {
        currentTokenCount += await getTokenCount(prompt.content);
      }
    }

    // 3. Build chat history within the remaining token budget
    const historyBudget = this.maxContext - currentTokenCount - (this.samplerSettings.max_tokens ?? 500);
    const historyMessages: ApiChatMessage[] = [];
    let historyTokenCount = 0;

    const historySource = this.forContinue ? this.chatHistory : this.chatHistory.slice(0, -1);

    for (let i = historySource.length - 1; i >= 0; i--) {
      const msg = this.chatHistory[i];
      if (msg.is_system) continue;

      const apiMsg: ApiChatMessage = {
        role: msg.is_user ? 'user' : 'assistant',
        content: msg.mes,
      };
      const msgTokenCount = await getTokenCount(apiMsg.content);

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

    return finalMessages;
  }
}
