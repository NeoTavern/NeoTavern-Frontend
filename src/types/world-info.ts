import type { Character } from './character';
import type { ChatMessage } from './chat';
import type { MessageRole } from './common';
import type { Persona } from './persona';
import type { Tokenizer } from './tokenizer';

export enum WorldInfoPosition {
  BEFORE_CHAR = 0,
  AFTER_CHAR = 1,
  BEFORE_AN = 2,
  AFTER_AN = 3,
  AT_DEPTH = 4,
  BEFORE_EM = 5,
  AFTER_EM = 6,
  OUTLET = 7,
}

export enum WorldInfoLogic {
  AND_ANY = 0,
  NOT_ALL = 1,
  NOT_ANY = 2,
  AND_ALL = 3,
}

export enum WorldInfoInsertionStrategy {
  EVENLY = 0,
  CHARACTER_FIRST = 1,
  GLOBAL_FIRST = 2,
}

export enum WorldInfoRole {
  SYSTEM = 0,
  USER = 1,
  ASSISTANT = 2,
}

export interface WorldInfoEntry {
  uid: number;
  key: string[];
  keysecondary: string[];
  comment: string; // Title/Memo
  content: string;
  constant: boolean;
  vectorized: boolean;
  selective: boolean;
  selectiveLogic: WorldInfoLogic;
  addMemo: boolean;
  order: number;
  position: WorldInfoPosition;
  disable: boolean;
  ignoreBudget: boolean;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  matchPersonaDescription: boolean;
  matchCharacterDescription: boolean;
  matchCharacterPersonality: boolean;
  matchCharacterDepthPrompt: boolean;
  matchScenario: boolean;
  matchCreatorNotes: boolean;
  delayUntilRecursion: number | boolean;
  probability: number;
  useProbability: boolean;
  depth: number;
  outletName: string;
  group: string;
  groupOverride: boolean;
  groupWeight: number;
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  useGroupScoring: boolean | null;
  automationId: string;
  role: WorldInfoRole;
  sticky: number | null;
  cooldown: number | null;
  delay: number | null;
  characterFilterNames: string[];
  characterFilterTags: string[];
  characterFilterExclude: boolean;
  triggers: string[];
}

export interface WorldInfoBook {
  name: string;
  entries: WorldInfoEntry[];
}

export interface WorldInfoSettings {
  world_info: Record<string, any>;
  world_info_depth: number;
  world_info_min_activations: number;
  world_info_min_activations_depth_max: number;
  world_info_budget: number;
  world_info_include_names: boolean;
  world_info_recursive: boolean;
  world_info_overflow_alert: boolean;
  world_info_case_sensitive: boolean;
  world_info_match_whole_words: boolean;
  world_info_character_strategy: WorldInfoInsertionStrategy;
  world_info_budget_cap: number;
  world_info_use_group_scoring: boolean;
  world_info_max_recursion_steps: number;
}

export interface ProcessedWorldInfo {
  worldInfoBefore: string;
  worldInfoAfter: string;
  anBefore: string[];
  anAfter: string[];
  emBefore: string[];
  emAfter: string[];
  depthEntries: { depth: number; role: MessageRole; entries: string[] }[];
  outletEntries: Record<string, string[]>;
}

export type WorldInfoOptions = {
  chat: ChatMessage[];
  character: Character;
  settings: WorldInfoSettings;
  books: WorldInfoBook[];
  persona: Persona;
  maxContext: number;
  tokenizer: Tokenizer;
};
