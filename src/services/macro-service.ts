import Handlebars from 'handlebars';
import type { Character, Persona } from '../types';

export interface MacroContextData {
  characters: Character[];
  persona?: Persona;
  activeCharacter?: Character;
  additionalMacros?: Record<string, unknown>;
}

export class MacroService {
  private static instance: MacroService;
  private readonly MAX_RECURSION = 10;
  private readonly COMMENT_REGEX = /\{\{\/\/[\s\S]*?\}\}/g;
  private readonly RAW_BLOCK_REGEX = /\{\{#raw\}\}([\s\S]*?)\{\{\/raw\}\}/g;

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
    Handlebars.registerHelper('raw', function (options) {
      return options.fn();
    });
    Handlebars.registerHelper('eq', function (a, b) {
      return a === b;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildContext(data: MacroContextData): Record<string, any> {
    const primaryChar = data.activeCharacter || data.characters[0];

    const baseContext = {
      user: data.persona?.name,
      persona: data.persona?.description,

      char: primaryChar?.name || 'Character',
      description: primaryChar?.description || '',
      personality: primaryChar?.personality || '',
      scenario: primaryChar?.scenario || '',
      mes_example: primaryChar?.mes_example || '',
      first_mes: primaryChar?.first_mes || '',

      chars: data.characters.map((c) => c.name),
    };

    return data.additionalMacros ? { ...baseContext, ...data.additionalMacros } : baseContext;
  }

  /**
   * Processes a string, replacing macros with context data.
   * Recursively processes the result up to MAX_RECURSION times to handle nested macros.
   * Also strips comments in the format {{// ... }} and preserves raw blocks {{#raw}}...{{/raw}}
   */
  public process(text: string, contextData: MacroContextData): string {
    if (!text) return '';

    let currentText = text;
    let depth = 0;
    const allRawBlocks: string[] = [];

    while (depth < this.MAX_RECURSION) {
      // Remove comments
      currentText = currentText.replace(this.COMMENT_REGEX, '');

      // Extract any new raw blocks (using a global counter to avoid collisions)
      const startIndex = allRawBlocks.length;
      currentText = currentText.replace(this.RAW_BLOCK_REGEX, (_match, content) => {
        const placeholder = `___RAW_BLOCK_${allRawBlocks.length}___`;
        allRawBlocks.push(content);
        return placeholder;
      });

      // If no new raw blocks were found and no macros left, we're done
      if (allRawBlocks.length === startIndex && !currentText.includes('{{')) {
        break;
      }

      // If no macros left, we're done
      if (!currentText.includes('{{')) {
        break;
      }

      try {
        const template = Handlebars.compile(currentText, { noEscape: true });
        const context = this.buildContext(contextData);
        const newText = template(context);

        // If text didn't change, we are done
        if (newText === currentText) {
          break;
        }

        currentText = newText;
        depth++;
      } catch (e) {
        console.error('MacroService: Failed to process template:', e);
        break;
      }
    }

    // Finally, restore all raw blocks
    return this.restoreRawBlocks(currentText, allRawBlocks);
  }

  private restoreRawBlocks(text: string, rawBlocks: string[]): string {
    let result = text;
    rawBlocks.forEach((content, index) => {
      result = result.replace(`___RAW_BLOCK_${index}___`, content);
    });
    return result;
  }
}

export const macroService = MacroService.getInstance();
