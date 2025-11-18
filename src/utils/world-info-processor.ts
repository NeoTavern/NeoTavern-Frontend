import {
  type ChatMessage,
  type Character,
  type WorldInfoBook,
  type WorldInfoEntry,
  type WorldInfoSettings,
  WorldInfoLogic,
  WorldInfoPosition,
  type Persona,
  type ProcessedWorldInfo,
  type WorldInfoOptions,
  type Tokenizer,
} from '../types';
import { eventEmitter } from './event-emitter';

// TODO: These should be sourced from a central place or settings
const MAX_SCAN_DEPTH = 1000;

// TODO: A simplified substitution, a full implementation would be more robust
function substituteParams(text: string, char: Character, user: string): string {
  if (!text) return '';
  return text.replace(/{{char}}/g, char.name).replace(/{{user}}/g, user);
}

// --- WorldInfoBuffer Class ---
// Manages the text content (chat history, descriptions) to be scanned.
class WorldInfoBuffer {
  #depthBuffer: string[] = [];
  #recurseBuffer: string[] = [];
  #settings: WorldInfoSettings;
  #character: Character;
  #persona: Persona;
  constructor(chat: ChatMessage[], settings: WorldInfoSettings, character: Character, persona: Persona) {
    this.#settings = settings;
    this.#character = character;
    this.#persona = persona;
    this.#initDepthBuffer(chat);
  }

  #initDepthBuffer(chat: ChatMessage[]) {
    // We only need the message content, reversed (most recent first)
    this.#depthBuffer = chat
      .map((msg) => msg.mes)
      .reverse()
      .slice(0, MAX_SCAN_DEPTH);
  }

  #transformString(str: string, entry: WorldInfoEntry): string {
    const caseSensitive = entry.caseSensitive ?? this.#settings.world_info_case_sensitive;
    return caseSensitive ? str : str.toLowerCase();
  }

  // Gets the full text to be scanned for a given entry
  get(entry: WorldInfoEntry): string {
    const depth = entry.scanDepth ?? this.#settings.world_info_depth;
    let buffer = this.#depthBuffer.slice(0, depth).join('\n');

    // Add other scannable sources
    if (entry.matchCharacterDescription) buffer += `\n${this.#character.description ?? ''}`;
    if (entry.matchCharacterPersonality) buffer += `\n${this.#character.personality ?? ''}`;
    if (entry.matchCharacterDepthPrompt) buffer += `\n${this.#character.data?.depth_prompt?.prompt ?? ''}`;
    if (entry.matchCreatorNotes) buffer += `\n${this.#character.data?.creator_notes ?? ''}`;
    if (entry.matchScenario) buffer += `\n${this.#character.scenario ?? ''}`;
    if (entry.matchPersonaDescription) buffer += `\n${this.#persona.description ?? ''}`;

    if (this.#recurseBuffer.length > 0) {
      buffer += `\n${this.#recurseBuffer.join('\n')}`;
    }

    return buffer;
  }

  // Checks if a given keyword (needle) exists in the buffer (haystack)
  matchKeys(haystack: string, needle: string, entry: WorldInfoEntry): boolean {
    // TODO: Implement regex support from original `parseRegexFromString`
    const transformedHaystack = this.#transformString(haystack, entry);
    const transformedNeedle = this.#transformString(needle, entry);
    const matchWholeWords = entry.matchWholeWords ?? this.#settings.world_info_match_whole_words;

    if (matchWholeWords) {
      // Simple whole word match for single words
      if (!transformedNeedle.includes(' ')) {
        const regex = new RegExp(`\\b${transformedNeedle}\\b`);
        return regex.test(transformedHaystack);
      }
    }
    return transformedHaystack.includes(transformedNeedle);
  }

  addRecurse(message: string) {
    this.#recurseBuffer.push(message);
  }
}

// --- Main Processor ---
export class WorldInfoProcessor {
  private chat: ChatMessage[];
  private character: Character;
  private settings: WorldInfoSettings;
  private books: WorldInfoBook[];
  private maxContext: number;
  private persona: Persona;
  private tokenizer: Tokenizer;

  constructor({ chat, character, settings, books, maxContext, persona, tokenizer }: WorldInfoOptions) {
    this.chat = chat;
    this.character = character;
    this.settings = settings;
    this.books = books;
    this.persona = persona;
    this.maxContext = maxContext;
    this.tokenizer = tokenizer;
  }

  public async process(): Promise<ProcessedWorldInfo> {
    const options: WorldInfoOptions = {
      chat: this.chat,
      character: this.character,
      settings: this.settings,
      books: this.books,
      persona: this.persona,
      maxContext: this.maxContext,
      tokenizer: this.tokenizer,
    };
    await eventEmitter.emit('world-info:processing-started', options);

    const buffer = new WorldInfoBuffer(this.chat, this.settings, this.character, this.persona);
    let allActivatedEntries = new Set<WorldInfoEntry>();
    let continueScanning = true;
    let loopCount = 0;
    let tokenBudgetOverflowed = false;

    let budget = Math.round((this.settings.world_info_budget * this.maxContext) / 100) || 1;
    if (this.settings.world_info_budget_cap > 0 && budget > this.settings.world_info_budget_cap) {
      budget = this.settings.world_info_budget_cap;
    }

    const allEntries = this.books.flatMap((book) => book.entries.map((entry) => ({ ...entry, world: book.name })));
    const sortedEntries = allEntries.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

    // TODO: Implement TimedEffects for sticky/cooldown
    // TODO: Implement Min Activations logic more fully with skew

    while (continueScanning && loopCount < (this.settings.world_info_max_recursion_steps || 10)) {
      loopCount++;
      let activatedInThisLoop = new Set<WorldInfoEntry>();
      let newContentForRecursion = '';
      let currentContentForBudget = '';

      for (const entry of sortedEntries) {
        if (allActivatedEntries.has(entry) || entry.disable) continue;

        // TODO: Add all filters: character, tags, timed effects etc.

        if (entry.constant) {
          activatedInThisLoop.add(entry);
          continue;
        }

        if (!entry.key || entry.key.length === 0) continue;

        const textToScan = buffer.get(entry);
        if (!textToScan) continue;

        const hasPrimaryKeyMatch = entry.key.some((key) => {
          const subbedKey = substituteParams(key, this.character, this.persona.name);
          return subbedKey && buffer.matchKeys(textToScan, subbedKey, entry);
        });

        if (hasPrimaryKeyMatch) {
          const hasSecondary = entry.keysecondary && entry.keysecondary.length > 0;
          if (!hasSecondary) {
            activatedInThisLoop.add(entry);
            continue;
          }

          // Handle secondary key logic
          let hasAnySecondaryMatch = false;
          let hasAllSecondaryMatch = true;
          for (const key of entry.keysecondary) {
            const subbedKey = substituteParams(key, this.character, this.persona.name);
            if (subbedKey && buffer.matchKeys(textToScan, subbedKey, entry)) {
              hasAnySecondaryMatch = true;
            } else {
              hasAllSecondaryMatch = false;
            }
          }

          let secondaryLogicPassed = false;
          switch (entry.selectiveLogic as WorldInfoLogic) {
            case WorldInfoLogic.AND_ANY:
              secondaryLogicPassed = hasAnySecondaryMatch;
              break;
            case WorldInfoLogic.AND_ALL:
              secondaryLogicPassed = hasAllSecondaryMatch;
              break;
            case WorldInfoLogic.NOT_ALL:
              secondaryLogicPassed = !hasAllSecondaryMatch;
              break;
            case WorldInfoLogic.NOT_ANY:
              secondaryLogicPassed = !hasAnySecondaryMatch;
              break;
          }

          if (secondaryLogicPassed) {
            activatedInThisLoop.add(entry);
          }
        }
      }

      // TODO: Filter by inclusion groups

      if (activatedInThisLoop.size > 0) {
        for (const entry of activatedInThisLoop) {
          if (tokenBudgetOverflowed && !entry.ignoreBudget) continue;

          // Probability Check
          const roll = Math.random() * 100;
          if (entry.useProbability && roll > entry.probability) {
            continue;
          }

          const substitutedContent = substituteParams(entry.content, this.character, this.persona.name);
          const contentForBudget = `\n${substitutedContent}`;
          const currentTokens = await this.tokenizer.getTokenCount(currentContentForBudget);
          const entryTokens = await this.tokenizer.getTokenCount(contentForBudget);

          if (!entry.ignoreBudget && currentTokens + entryTokens > budget) {
            tokenBudgetOverflowed = true;
            continue;
          }

          currentContentForBudget += contentForBudget;
          allActivatedEntries.add(entry);
          await eventEmitter.emit('world-info:entry-activated', entry);

          if (this.settings.world_info_recursive && !entry.preventRecursion) {
            newContentForRecursion += `\n${substitutedContent}`;
          }
        }

        if (newContentForRecursion) {
          buffer.addRecurse(newContentForRecursion);
          continueScanning = true;
        } else {
          continueScanning = false;
        }
      } else {
        continueScanning = false;
      }
    }

    // Build the final prompt strings
    const result: ProcessedWorldInfo = {
      worldInfoBefore: '',
      worldInfoAfter: '',
      anBefore: [],
      anAfter: [],
      emBefore: [],
      emAfter: [],
      depthEntries: [],
      outletEntries: {},
    };

    const finalEntries = Array.from(allActivatedEntries).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

    for (const entry of finalEntries) {
      const content = substituteParams(entry.content, this.character, this.persona.name);
      if (!content) continue;

      switch (entry.position) {
        case WorldInfoPosition.BEFORE_CHAR:
          result.worldInfoBefore += `${content}\n`;
          break;
        case WorldInfoPosition.AFTER_CHAR:
          result.worldInfoAfter += `${content}\n`;
          break;
        case WorldInfoPosition.BEFORE_AN:
          result.anBefore.push(content);
          break;
        case WorldInfoPosition.AFTER_AN:
          result.anAfter.push(content);
          break;
        case WorldInfoPosition.BEFORE_EM:
          result.emBefore.push(content);
          break;
        case WorldInfoPosition.AFTER_EM:
          result.emAfter.push(content);
          break;
        case WorldInfoPosition.AT_DEPTH:
          // TODO: Implement role mapping
          result.depthEntries.push({ depth: entry.depth, role: 'system', entries: [content] });
          break;
        case WorldInfoPosition.OUTLET:
          if (entry.outletName) {
            if (!result.outletEntries[entry.outletName]) {
              result.outletEntries[entry.outletName] = [];
            }
            result.outletEntries[entry.outletName].push(content);
          }
          break;
      }
    }

    result.worldInfoBefore = result.worldInfoBefore.trim();
    result.worldInfoAfter = result.worldInfoAfter.trim();

    await eventEmitter.emit('world-info:processing-finished', result);
    return result;
  }
}
