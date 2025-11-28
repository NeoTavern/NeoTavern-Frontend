import Handlebars from 'handlebars';
import type { Character, Persona } from '../types';

export interface MacroContextData {
  characters: Character[];
  persona: Persona;
  activeCharacter?: Character;
}

export class MacroService {
  private static instance: MacroService;
  private readonly MAX_RECURSION = 10;

  private constructor() {
    this.registerGlobalHelpers();
  }

  public static getInstance(): MacroService {
    if (!MacroService.instance) {
      MacroService.instance = new MacroService();
    }
    return MacroService.instance;
  }

  private registerGlobalHelpers() {
    Handlebars.registerHelper('time', () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    Handlebars.registerHelper('date', () => new Date().toLocaleDateString());
    Handlebars.registerHelper('weekday', () => new Date().toLocaleDateString(undefined, { weekday: 'long' }));
    Handlebars.registerHelper('random', (min, max) => {
      if (typeof min !== 'number' || typeof max !== 'number') return 0;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildContext(data: MacroContextData): Record<string, any> {
    const primaryChar = data.activeCharacter || data.characters[0];

    return {
      user: data.persona.name,
      persona: data.persona.description,

      char: primaryChar?.name || 'Character',
      description: primaryChar?.description || '',
      personality: primaryChar?.personality || '',
      scenario: primaryChar?.scenario || '',
      mes_example: primaryChar?.mes_example || '',
      first_mes: primaryChar?.first_mes || '',

      chars: data.characters.map((c) => c.name),
    };
  }

  /**
   * Processes a string, replacing macros with context data.
   * Recursively processes the result up to MAX_RECURSION times to handle nested macros.
   */
  public process(text: string, contextData: MacroContextData): string {
    if (!text) return '';

    let currentText = text;
    let depth = 0;

    while (currentText.includes('{{') && depth < this.MAX_RECURSION) {
      try {
        const template = Handlebars.compile(currentText, { noEscape: true });
        const context = this.buildContext(contextData);
        const newText = template(context);

        // If text didn't change, we are done (macros resolved or unresolvable)
        if (newText === currentText) {
          break;
        }

        currentText = newText;
        depth++;
      } catch (e) {
        console.warn('MacroService: Failed to process template:', e);
        break;
      }
    }

    return currentText;
  }
}

export const macroService = MacroService.getInstance();
