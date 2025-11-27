import { WorldInfoLogic, WorldInfoPosition, WorldInfoRole } from '../constants';
import type {
  Character,
  CharacterBook,
  CharacterBookEntry,
  ChatMessage,
  Persona,
  ProcessedWorldInfo,
  Tokenizer,
  WorldInfoBook,
  WorldInfoEntry,
  WorldInfoOptions,
  WorldInfoSettings,
} from '../types';
import { eventEmitter } from '../utils/extensions';
import { macroService } from './macro-service';

const DEFAULT_DEPTH = 4;
const DEFAULT_WEIGHT = 100;
const MAX_SCAN_DEPTH = 100;

enum ScanState {
  NONE = 0,
  INITIAL = 1,
  RECURSION = 2,
  MIN_ACTIVATIONS = 3,
}

// --- Factory & Conversion Logic ---

export function createDefaultEntry(uid: number): WorldInfoEntry {
  return {
    uid,
    key: [],
    keysecondary: [],
    comment: 'New Entry',
    content: '',
    constant: false,
    vectorized: false,
    selective: false,
    selectiveLogic: WorldInfoLogic.AND_ANY,
    addMemo: false,
    order: 100,
    position: WorldInfoPosition.BEFORE_CHAR,
    disable: false,
    ignoreBudget: false,
    excludeRecursion: false,
    preventRecursion: false,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    delayUntilRecursion: false,
    probability: 100,
    useProbability: false,
    depth: 4,
    outletName: '',
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: 0,
    sticky: null,
    cooldown: null,
    delay: null,
    characterFilterNames: [],
    characterFilterTags: [],
    characterFilterExclude: false,
    triggers: [],
  };
}

export function convertCharacterBookToWorldInfoBook(charBook: CharacterBook): WorldInfoBook {
  const entries: WorldInfoEntry[] = (charBook.entries || []).map((entry, index) => {
    const uid = entry.id !== undefined ? entry.id : index;
    return {
      uid,
      key: entry.keys || [],
      keysecondary: entry.secondary_keys || [],
      comment: entry.comment || '',
      content: entry.content || '',
      constant: entry.constant || false,
      selective: entry.selective || false,
      order: entry.insertion_order || 100,
      position:
        entry.extensions?.position ??
        (entry.position === 'before_char' ? WorldInfoPosition.BEFORE_CHAR : WorldInfoPosition.AFTER_CHAR),
      excludeRecursion: entry.extensions?.exclude_recursion ?? false,
      preventRecursion: entry.extensions?.prevent_recursion ?? false,
      delayUntilRecursion: entry.extensions?.delay_until_recursion ?? false,
      disable: entry.enabled === false,
      addMemo: !!entry.comment,
      probability: entry.extensions?.probability ?? 100,
      useProbability: entry.extensions?.useProbability ?? true,
      depth: entry.extensions?.depth ?? DEFAULT_DEPTH,
      selectiveLogic: entry.extensions?.selectiveLogic ?? WorldInfoLogic.AND_ANY,
      outletName: entry.extensions?.outlet_name ?? '',
      group: entry.extensions?.group ?? '',
      groupOverride: entry.extensions?.group_override ?? false,
      groupWeight: entry.extensions?.group_weight ?? DEFAULT_WEIGHT,
      scanDepth: entry.extensions?.scan_depth ?? null,
      caseSensitive: entry.extensions?.case_sensitive ?? null,
      matchWholeWords: entry.extensions?.match_whole_words ?? null,
      useGroupScoring: entry.extensions?.use_group_scoring ?? null,
      automationId: entry.extensions?.automation_id ?? '',
      role: entry.extensions?.role ?? WorldInfoRole.SYSTEM,
      vectorized: entry.extensions?.vectorized ?? false,
      sticky: entry.extensions?.sticky ?? null,
      cooldown: entry.extensions?.cooldown ?? null,
      delay: entry.extensions?.delay ?? null,
      matchPersonaDescription: entry.extensions?.match_persona_description ?? false,
      matchCharacterDescription: entry.extensions?.match_character_description ?? false,
      matchCharacterPersonality: entry.extensions?.match_character_personality ?? false,
      matchCharacterDepthPrompt: entry.extensions?.match_character_depth_prompt ?? false,
      matchScenario: entry.extensions?.match_scenario ?? false,
      matchCreatorNotes: entry.extensions?.match_creator_notes ?? false,
      characterFilterNames: [],
      characterFilterTags: [],
      characterFilterExclude: false,
      triggers: entry.extensions?.triggers || [],
      ignoreBudget: entry.extensions?.ignore_budget ?? false,
    };
  });

  return { name: charBook.name || 'Embedded Lorebook', entries };
}

export function convertWorldInfoBookToCharacterBook(wiBook: WorldInfoBook): CharacterBook {
  const entries: CharacterBookEntry[] = wiBook.entries.map((entry) => {
    return {
      id: entry.uid,
      keys: entry.key,
      secondary_keys: entry.keysecondary,
      comment: entry.comment,
      content: entry.content,
      constant: entry.constant,
      selective: entry.selective,
      insertion_order: entry.order,
      enabled: !entry.disable,
      position: entry.position === WorldInfoPosition.BEFORE_CHAR ? 'before_char' : 'after_char',
      use_regex: true,
      extensions: {
        position: entry.position,
        exclude_recursion: entry.excludeRecursion,
        prevent_recursion: entry.preventRecursion,
        delay_until_recursion: entry.delayUntilRecursion,
        probability: entry.probability,
        useProbability: entry.useProbability,
        depth: entry.depth,
        selectiveLogic: entry.selectiveLogic,
        outlet_name: entry.outletName,
        group: entry.group,
        group_override: entry.groupOverride,
        group_weight: entry.groupWeight,
        scan_depth: entry.scanDepth,
        case_sensitive: entry.caseSensitive,
        match_whole_words: entry.matchWholeWords,
        use_group_scoring: entry.useGroupScoring,
        automation_id: entry.automationId,
        role: entry.role,
        vectorized: entry.vectorized,
        sticky: entry.sticky,
        cooldown: entry.cooldown,
        delay: entry.delay,
        match_persona_description: entry.matchPersonaDescription,
        match_character_description: entry.matchCharacterDescription,
        match_character_personality: entry.matchCharacterPersonality,
        match_character_depth_prompt: entry.matchCharacterDepthPrompt,
        match_scenario: entry.matchScenario,
        match_creator_notes: entry.matchCreatorNotes,
        characterFilterNames: entry.characterFilterNames,
        characterFilterTags: entry.characterFilterTags,
        characterFilterExclude: entry.characterFilterExclude,
        triggers: entry.triggers,
        ignore_budget: entry.ignoreBudget,
      },
    };
  });

  return { name: wiBook.name, entries };
}

// --- Processor Logic ---

interface ProcessingEntry extends WorldInfoEntry {
  world: string;
}

class WorldInfoBuffer {
  #depthBuffer: string[] = [];
  #recurseBuffer: string[] = [];
  #injectBuffer: string[] = [];
  #settings: WorldInfoSettings;
  #character: Character;
  #persona: Persona;
  #skew = 0;

  constructor(chat: ChatMessage[], settings: WorldInfoSettings, characters: Character[], persona: Persona) {
    this.#settings = settings;
    this.#character = characters[0];
    this.#persona = persona;
    this.#initDepthBuffer(chat);
  }

  #initDepthBuffer(chat: ChatMessage[]) {
    this.#depthBuffer = chat
      .map((msg) => msg.mes)
      .reverse()
      .slice(0, MAX_SCAN_DEPTH);
  }

  #transformString(str: string, entry: WorldInfoEntry): string {
    const caseSensitive = entry.caseSensitive ?? this.#settings.caseSensitive;
    return caseSensitive ? str : str.toLowerCase();
  }

  get(entry: WorldInfoEntry, scanState: ScanState): string {
    const entryScanDepth = entry.scanDepth ?? this.#settings.depth;
    const depth = entryScanDepth + this.#skew;

    let buffer = this.#depthBuffer.slice(0, depth).join('\n');

    if (entry.matchCharacterDescription) buffer += `\n${this.#character.description ?? ''}`;
    if (entry.matchCharacterPersonality) buffer += `\n${this.#character.personality ?? ''}`;
    if (entry.matchCharacterDepthPrompt) buffer += `\n${this.#character.data?.depth_prompt?.prompt ?? ''}`;
    if (entry.matchCreatorNotes) buffer += `\n${this.#character.data?.creator_notes ?? ''}`;
    if (entry.matchScenario) buffer += `\n${this.#character.scenario ?? ''}`;
    if (entry.matchPersonaDescription) buffer += `\n${this.#persona.description ?? ''}`;

    if (this.#injectBuffer.length > 0) {
      buffer += `\n${this.#injectBuffer.join('\n')}`;
    }

    // Min activations should not include the recursion buffer
    if (this.#recurseBuffer.length > 0 && scanState !== ScanState.MIN_ACTIVATIONS) {
      buffer += `\n${this.#recurseBuffer.join('\n')}`;
    }

    return buffer;
  }

  matchKeys(haystack: string, needle: string, entry: WorldInfoEntry): boolean {
    const regexMatch = needle.match(/^\/(.+)\/([a-z]*)$/);
    if (regexMatch) {
      try {
        const pattern = regexMatch[1];
        const flags = regexMatch[2];
        const regex = new RegExp(pattern, flags);
        return regex.test(haystack);
      } catch (e) {
        console.warn(`Invalid regex in World Info entry: ${needle}`, e);
        return false;
      }
    }

    const transformedHaystack = this.#transformString(haystack, entry);
    const transformedNeedle = this.#transformString(needle, entry);
    const matchWholeWords = entry.matchWholeWords ?? this.#settings.matchWholeWords;

    if (matchWholeWords) {
      const escapedNeedle = transformedNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedNeedle}\\b`);
      return regex.test(transformedHaystack);
    }
    return transformedHaystack.includes(transformedNeedle);
  }

  addRecurse(message: string) {
    this.#recurseBuffer.push(message);
  }

  addInject(message: string) {
    this.#injectBuffer.push(message);
  }

  hasRecurse() {
    return this.#recurseBuffer.length > 0;
  }

  advanceScan() {
    this.#skew++;
  }

  getDepth() {
    return this.#settings.depth + this.#skew;
  }
}

export class WorldInfoProcessor {
  public chat: ChatMessage[];
  public characters: Character[];
  public character: Character;
  public settings: WorldInfoSettings;
  public maxContext: number;
  public books: WorldInfoBook[];
  public persona: Persona;
  public tokenizer: Tokenizer;
  public generationId: string;

  constructor({ chat, characters, settings, books, maxContext, persona, tokenizer, generationId }: WorldInfoOptions) {
    this.chat = chat;
    this.characters = characters;
    this.character = characters[0];
    this.settings = settings;
    this.books = books;
    this.persona = persona;
    this.maxContext = maxContext;
    this.tokenizer = tokenizer;
    this.generationId = generationId;
  }

  private checkFilters(entry: ProcessingEntry, scanState: ScanState): boolean {
    // 0. Disable check
    if (entry.disable) return false;

    // 1. Decorators
    // TODO: Implement @@activate and @@dont_activate properly if stored in decorators field.
    // Assuming decorators are not yet in WorldInfoEntry type explicitly or are part of content parsing.
    // For now, if content starts with @@dont_activate (hack), skip.
    if (entry.content.trim().startsWith('@@dont_activate')) return false;

    // 2. Check Delay (Skip if chat length is less than delay)
    // Note: This is simple delay, not "Timed Effects" persistent delay.
    if (entry.delay && this.chat.length < entry.delay) {
      return false;
    }

    // 3. Recursion Logic
    // If scanning for recursion, and entry prohibits it
    if (scanState === ScanState.RECURSION && this.settings.recursive && entry.excludeRecursion) {
      return false;
    }

    // If delayUntilRecursion is set, it should only activate during Recursion phase
    // For simplicity, we treat boolean true as "Level 1" recursion
    if (entry.delayUntilRecursion) {
      if (scanState !== ScanState.RECURSION) return false;
    }

    // 4. Character Filters
    const hasNameFilter = entry.characterFilterNames && entry.characterFilterNames.length > 0;
    const hasTagFilter = entry.characterFilterTags && entry.characterFilterTags.length > 0;

    // If no filters are set, we pass
    if (!hasNameFilter && !hasTagFilter) {
      return true;
    }

    let match = false;

    // Name Match
    if (hasNameFilter) {
      if (entry.characterFilterNames.includes(this.character.name)) {
        match = true;
      }
    }

    // Tag Match
    if (!match && hasTagFilter && this.character.tags) {
      const charTags = this.character.tags.map((t) => t.toLowerCase());
      const filterTags = entry.characterFilterTags.map((t) => t.toLowerCase());
      if (filterTags.some((t) => charTags.includes(t))) {
        match = true;
      }
    }

    // Handle Exclude logic
    if (entry.characterFilterExclude) {
      return !match;
    }

    return match;
  }

  public async process(): Promise<ProcessedWorldInfo> {
    const options: WorldInfoOptions = {
      chat: this.chat,
      characters: this.characters,
      settings: this.settings,
      books: this.books,
      persona: this.persona,
      maxContext: this.maxContext,
      tokenizer: this.tokenizer,
      generationId: this.generationId,
    };
    await eventEmitter.emit('world-info:processing-started', options);

    const buffer = new WorldInfoBuffer(this.chat, this.settings, this.characters, this.persona);
    const allActivatedEntries = new Map<string, ProcessingEntry>(); // Key: world.uid

    let scanState: ScanState = ScanState.INITIAL;
    let loopCount = 0;
    let tokenBudgetOverflowed = false;

    let budget = Math.round((this.settings.budget * this.maxContext) / 100) || 1;
    if (this.settings.budgetCap > 0 && budget > this.settings.budgetCap) {
      budget = this.settings.budgetCap;
    }

    const allEntries: ProcessingEntry[] = this.books.flatMap((book) =>
      book.entries.map((entry) => ({ ...entry, world: book.name })),
    );
    const sortedEntries = allEntries.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

    // Determine available recursion delay levels
    const availableRecursionDelayLevels = [
      ...new Set(
        sortedEntries
          .filter((e) => e.delayUntilRecursion)
          .map((e) => (e.delayUntilRecursion === true ? 1 : (e.delayUntilRecursion as number))),
      ),
    ].sort((a, b) => a - b);
    let currentRecursionDelayLevel = availableRecursionDelayLevels.shift() ?? 0;

    while (scanState !== ScanState.NONE) {
      if (this.settings.maxRecursionSteps && loopCount >= this.settings.maxRecursionSteps) {
        break;
      }
      loopCount++;

      let nextScanState = ScanState.NONE;
      const activatedInThisLoop = new Set<ProcessingEntry>();

      for (const entry of sortedEntries) {
        const uniqueId = `${entry.world}.${entry.uid}`;
        if (allActivatedEntries.has(uniqueId)) continue;

        if (!this.checkFilters(entry, scanState)) continue;

        // Recursion Level Check
        if (
          scanState === ScanState.RECURSION &&
          entry.delayUntilRecursion &&
          (entry.delayUntilRecursion === true ? 1 : entry.delayUntilRecursion) > currentRecursionDelayLevel
        ) {
          continue;
        }

        if (entry.constant) {
          activatedInThisLoop.add(entry);
          continue;
        }

        if (!entry.key || entry.key.length === 0) continue;

        const textToScan = buffer.get(entry, scanState);
        if (!textToScan) continue;

        const hasPrimaryKeyMatch = entry.key.some((key) => {
          const subbedKey = macroService.process(key, { characters: this.characters, persona: this.persona });
          return subbedKey && buffer.matchKeys(textToScan, subbedKey, entry);
        });

        if (hasPrimaryKeyMatch) {
          const hasSecondary = entry.keysecondary && entry.keysecondary.length > 0;
          if (!hasSecondary) {
            activatedInThisLoop.add(entry);
            continue;
          }

          let hasAnySecondaryMatch = false;
          let hasAllSecondaryMatch = true;
          for (const key of entry.keysecondary) {
            const subbedKey = macroService.process(key, { characters: this.characters, persona: this.persona });
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

      const candidates = Array.from(activatedInThisLoop);
      const groupFilteredCandidates: ProcessingEntry[] = [];
      const blockedGroups = new Set<string>();

      for (const entry of allActivatedEntries.values()) {
        if (entry.group && entry.groupOverride) {
          blockedGroups.add(entry.group);
        }
      }

      candidates.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

      for (const entry of candidates) {
        if (entry.group) {
          if (blockedGroups.has(entry.group)) continue;
          if (entry.groupOverride) {
            blockedGroups.add(entry.group);
          }
        }
        groupFilteredCandidates.push(entry);
      }

      const successfulNewEntries: ProcessingEntry[] = [];
      let newContentForRecursion = '';
      let currentUsedBudget = 0;

      for (const entry of groupFilteredCandidates) {
        if (tokenBudgetOverflowed && !entry.ignoreBudget) continue;

        const roll = Math.random() * 100;
        if (entry.useProbability && roll > entry.probability) continue;

        const substitutedContent = macroService.process(entry.content, {
          characters: this.characters,
          persona: this.persona,
        });

        const contentForBudget = `\n${substitutedContent}`;
        const tokens = await this.tokenizer.getTokenCount(contentForBudget);

        if (!entry.ignoreBudget && currentUsedBudget + tokens > budget) {
          tokenBudgetOverflowed = true;
          continue;
        }

        currentUsedBudget += tokens;
        successfulNewEntries.push(entry);
        allActivatedEntries.set(`${entry.world}.${entry.uid}`, entry);

        await eventEmitter.emit('world-info:entry-activated', entry, { generationId: this.generationId });

        if (this.settings.recursive && !entry.preventRecursion) {
          newContentForRecursion += `\n${substitutedContent}`;
        }
      }

      // Determine next state
      if (this.settings.recursive && !tokenBudgetOverflowed && successfulNewEntries.length > 0) {
        nextScanState = ScanState.RECURSION;
      }

      // Min Activations Check
      const minActivationsNotSatisfied =
        this.settings.minActivations > 0 && allActivatedEntries.size < this.settings.minActivations;

      if (
        nextScanState === ScanState.NONE &&
        !tokenBudgetOverflowed &&
        minActivationsNotSatisfied &&
        scanState !== ScanState.RECURSION // Don't trigger min activations if we just came from recursion, unless logic dictates
      ) {
        const overMax =
          (this.settings.minActivationsDepthMax > 0 && buffer.getDepth() > this.settings.minActivationsDepthMax) ||
          buffer.getDepth() > this.chat.length;

        if (!overMax) {
          nextScanState = ScanState.MIN_ACTIVATIONS;
          buffer.advanceScan();
        }
      }

      // Recursive Delay Level Logic
      if (nextScanState === ScanState.NONE && availableRecursionDelayLevels.length > 0) {
        nextScanState = ScanState.RECURSION;
        currentRecursionDelayLevel = availableRecursionDelayLevels.shift() ?? 0;
      }

      if (nextScanState !== ScanState.NONE && newContentForRecursion) {
        buffer.addRecurse(newContentForRecursion);
      }

      scanState = nextScanState;
    }

    const result: ProcessedWorldInfo = {
      worldInfoBefore: '',
      worldInfoAfter: '',
      anBefore: [],
      anAfter: [],
      emBefore: [],
      emAfter: [],
      depthEntries: [],
      outletEntries: {},
      triggeredEntries: {},
    };

    const finalEntries = Array.from(allActivatedEntries.values()).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

    for (const entry of finalEntries) {
      if (!result.triggeredEntries[entry.world]) {
        result.triggeredEntries[entry.world] = [];
      }
      result.triggeredEntries[entry.world].push(entry);

      const content = macroService.process(entry.content, { characters: this.characters, persona: this.persona });
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
          result.depthEntries.push({ depth: entry.depth, role: 'system', entries: [content] });
          break;
        case WorldInfoPosition.OUTLET:
          if (entry.outletName) {
            if (!result.outletEntries[entry.outletName]) result.outletEntries[entry.outletName] = [];
            result.outletEntries[entry.outletName].push(content);
          }
          break;
      }
    }

    result.worldInfoBefore = result.worldInfoBefore.trim();
    result.worldInfoAfter = result.worldInfoAfter.trim();

    await eventEmitter.emit('world-info:processing-finished', result, { generationId: this.generationId });
    return result;
  }
}
