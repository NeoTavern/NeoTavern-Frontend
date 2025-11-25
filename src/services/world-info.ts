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

const DEFAULT_DEPTH = 4;
const DEFAULT_WEIGHT = 100;
const MAX_SCAN_DEPTH = 1000;

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

function substituteParams(text: string, char: Character, user: string): string {
  if (!text) return '';
  return text.replace(/{{char}}/g, char.name).replace(/{{user}}/g, user);
}

class WorldInfoBuffer {
  #depthBuffer: string[] = [];
  #recurseBuffer: string[] = [];
  #settings: WorldInfoSettings;
  #character: Character;
  #persona: Persona;
  #cachedFullString: string | null = null;
  #cachedRecursionString: string | null = null;

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

  get(entry: WorldInfoEntry): string {
    const depth = entry.scanDepth ?? this.#settings.depth;
    let buffer = '';

    if (depth === this.#settings.depth && this.#cachedFullString !== null) {
      buffer = this.#cachedFullString;
    } else {
      buffer = this.#depthBuffer.slice(0, depth).join('\n');
      if (entry.matchCharacterDescription) buffer += `\n${this.#character.description ?? ''}`;
      if (entry.matchCharacterPersonality) buffer += `\n${this.#character.personality ?? ''}`;
      if (entry.matchCharacterDepthPrompt) buffer += `\n${this.#character.data?.depth_prompt?.prompt ?? ''}`;
      if (entry.matchCreatorNotes) buffer += `\n${this.#character.data?.creator_notes ?? ''}`;
      if (entry.matchScenario) buffer += `\n${this.#character.scenario ?? ''}`;
      if (entry.matchPersonaDescription) buffer += `\n${this.#persona.description ?? ''}`;

      if (depth === this.#settings.depth) {
        this.#cachedFullString = buffer;
      }
    }

    if (this.#recurseBuffer.length > 0) {
      if (!this.#cachedRecursionString) {
        this.#cachedRecursionString = this.#recurseBuffer.join('\n');
      }
      buffer += `\n${this.#cachedRecursionString}`;
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
    this.#cachedRecursionString = null;
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
    const allActivatedEntries = new Set<ProcessingEntry>();
    let continueScanning = true;
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

    while (continueScanning && loopCount < (this.settings.maxRecursionSteps || 10) && sortedEntries.length > 0) {
      loopCount++;
      const activatedInThisLoop = new Set<ProcessingEntry>();
      let newContentForRecursion = '';
      let currentUsedBudget = 0;

      for (const entry of sortedEntries) {
        if (allActivatedEntries.has(entry) || entry.disable) continue;
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

      if (activatedInThisLoop.size > 0) {
        const candidates: { entry: ProcessingEntry; content: string; rawContent: string }[] = [];

        for (const entry of activatedInThisLoop) {
          if (tokenBudgetOverflowed && !entry.ignoreBudget) continue;
          const roll = Math.random() * 100;
          if (entry.useProbability && roll > entry.probability) continue;

          const substitutedContent = substituteParams(entry.content, this.character, this.persona.name);
          const contentForBudget = `\n${substitutedContent}`;
          candidates.push({ entry, content: contentForBudget, rawContent: substitutedContent });
        }

        if (candidates.length > 0) {
          const tokenCounts = await Promise.all(candidates.map((c) => this.tokenizer.getTokenCount(c.content)));

          for (let i = 0; i < candidates.length; i++) {
            const { entry, rawContent } = candidates[i];
            const entryTokens = tokenCounts[i];

            if (!entry.ignoreBudget && currentUsedBudget + entryTokens > budget) {
              tokenBudgetOverflowed = true;
              continue;
            }

            currentUsedBudget += entryTokens;
            allActivatedEntries.add(entry);
            await eventEmitter.emit('world-info:entry-activated', entry, { generationId: this.generationId });

            if (this.settings.recursive && !entry.preventRecursion) {
              newContentForRecursion += `\n${rawContent}`;
            }
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

    const finalEntries = Array.from(allActivatedEntries).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

    for (const entry of finalEntries) {
      if (!result.triggeredEntries[entry.world]) {
        result.triggeredEntries[entry.world] = [];
      }
      result.triggeredEntries[entry.world].push(entry);

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
