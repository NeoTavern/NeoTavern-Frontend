import type { Character, ChatMessage } from '../types';
import type { ApiChatMessage } from '../api/generation';
import { useUiStore } from '../stores/ui.store';
import { useApiStore } from '../stores/api.store';
import { useWorldInfoStore } from '../stores/world-info.store';
import { WorldInfoProcessor } from './world-info-processor';

// TODO: Add proper templating engine
function substitute(text: string, char: Character, user: string): string {
  if (!text) return '';
  return text.replace(/{{char}}/g, char.name).replace(/{{user}}/g, user);
}

export class PromptBuilder {
  private character: Character;
  private chatHistory: ChatMessage[];
  private settings: ReturnType<typeof useApiStore>['oaiSettings'];
  private playerName: string;
  private maxContext: number;

  constructor(character: Character, chatHistory: ChatMessage[]) {
    this.character = character;
    this.chatHistory = chatHistory;

    // Stores need to be accessed inside the constructor or methods
    const apiStore = useApiStore();
    const uiStore = useUiStore();

    this.settings = apiStore.oaiSettings;
    this.playerName = uiStore.activePlayerName || 'User';
    this.maxContext = apiStore.oaiSettings.openai_max_context ?? 4096;
  }

  public async build(): Promise<ApiChatMessage[]> {
    const messages: ApiChatMessage[] = [];
    const worldInfoStore = useWorldInfoStore();

    // Process World Info first
    const activeBooks = worldInfoStore.bookNames
      .filter((name) => worldInfoStore.activeBookNames.includes(name))
      .map((name) => worldInfoStore.getBookFromCache(name));

    const processor = new WorldInfoProcessor(
      this.chatHistory,
      this.character,
      worldInfoStore.settings,
      activeBooks.filter((book): book is NonNullable<typeof book> => book !== null),
      this.playerName,
      this.maxContext,
    );
    const { worldInfoBefore, worldInfoAfter } = await processor.process();

    const promptOrderConfig = this.settings.prompt_order?.[0]; // Not using character_id
    if (!promptOrderConfig) {
      console.error('Default prompt order not found in settings.');
      return [];
    }

    const enabledPrompts = promptOrderConfig.order.filter((p) => p.enabled);

    for (const promptConfig of enabledPrompts) {
      const promptDefinition = this.settings.prompts?.find((p) => p.identifier === promptConfig.identifier);
      if (!promptDefinition) continue;

      if (promptDefinition.marker) {
        switch (promptDefinition.identifier) {
          case 'chatHistory':
            messages.push(...this.getChatHistoryMessages());
            break;
          case 'charDescription':
            if (this.character.description) {
              messages.push({ role: promptDefinition.role ?? 'system', content: this.character.description });
            }
            break;
          case 'charPersonality':
            if (this.character.personality) {
              messages.push({ role: promptDefinition.role ?? 'system', content: this.character.personality });
            }
            break;
          case 'scenario':
            if (this.character.scenario) {
              messages.push({ role: promptDefinition.role ?? 'system', content: this.character.scenario });
            }
            break;
          case 'dialogueExamples':
            if (this.character.mes_example) {
              const example = substitute(this.character.mes_example, this.character, this.playerName);
              const examples = example.split('<START>');
              for (const ex of examples) {
                // FIXME: I'm not sure this is correct.
                if (ex.trim()) messages.push({ role: promptDefinition.role ?? 'system', content: ex.trim() });
              }
            }
            break;
          case 'worldInfoBefore':
            if (worldInfoBefore) {
              messages.push({ role: promptDefinition.role ?? 'system', content: worldInfoBefore });
            }
            break;
          case 'worldInfoAfter':
            if (worldInfoAfter) {
              messages.push({ role: promptDefinition.role ?? 'system', content: worldInfoAfter });
            }
            break;
        }
      } else {
        if (promptDefinition.content && promptDefinition.role) {
          const content = substitute(promptDefinition.content, this.character, this.playerName);

          if (content) {
            messages.push({ role: promptDefinition.role, content });
          }
        }
      }
    }
    // TODO: Handle other WI positions like AT_DEPTH, EM, etc.
    return messages;
  }

  private getChatHistoryMessages(): ApiChatMessage[] {
    return this.chatHistory
      .filter((msg) => !msg.is_system)
      .map((msg) => ({
        role: msg.is_user ? 'user' : 'assistant',
        content: msg.mes,
      }));
  }
}
