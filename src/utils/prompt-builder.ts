import type { Character, ChatMessage } from '../types';
import type { ApiChatMessage } from '../api/generation';
import { useUiStore } from '../stores/ui.store';
import { useApiStore } from '../stores/api.store';

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

  constructor(character: Character, chatHistory: ChatMessage[]) {
    this.character = character;
    this.chatHistory = chatHistory;

    // Stores need to be accessed inside the constructor or methods
    const apiStore = useApiStore();
    const uiStore = useUiStore();

    this.settings = apiStore.oaiSettings;
    this.playerName = uiStore.activePlayerName || 'User';
  }

  public build(): ApiChatMessage[] {
    const messages: ApiChatMessage[] = [];

    const promptOrderConfig = this.settings.prompt_order?.find((p) => p.character_id === 100000);
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
              messages.push({ role: 'system', content: this.character.description });
            }
            break;
          case 'charPersonality':
            if (this.character.personality) {
              messages.push({ role: 'system', content: this.character.personality });
            }
            break;
          case 'scenario':
            if (this.character.scenario) {
              messages.push({ role: 'system', content: this.character.scenario });
            }
            break;
          case 'dialogueExamples':
            if (this.character.mes_example) {
              const example = substitute(this.character.mes_example, this.character, this.playerName);
              const examples = example.split('<START>');
              for (const ex of examples) {
                // FIXME: I'm not sure this is correct.
                if (ex.trim()) messages.push({ role: 'system', content: ex.trim() });
              }
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
