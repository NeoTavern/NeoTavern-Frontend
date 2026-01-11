import type { WorldInfoLogic, WorldInfoPosition, WorldInfoRole } from '../constants';
import type { Character } from './character';
import type { ChatMessage } from './chat';
import type { MessageRole } from './common';
import type { Persona } from './persona';
import type { Tokenizer } from './tokenizer';

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
  extensions?: Record<string, unknown>;
}

export interface WorldInfoBook {
  name: string;
  entries: WorldInfoEntry[];
}

export type WorldInfoHeader = {
  file_id: string;
  name: string;
};

export interface LegacyWorldInfoSettings {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  world_info_budget_cap: number;
  world_info_use_group_scoring: boolean;
  world_info_max_recursion_steps: number;
}

export interface WorldInfoSettings {
  activeBookNames: string[];
  depth: number;
  minActivations: number;
  minActivationsDepthMax: number;
  budget: number;
  includeNames: boolean;
  recursive: boolean;
  overflowAlert: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  budgetCap: number;
  useGroupScoring: boolean;
  maxRecursionSteps: number;
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
  triggeredEntries: Record<string, WorldInfoEntry[]>;
}

export type WorldInfoOptions = {
  generationId: string;
  chat: ChatMessage[];
  characters: Character[];
  settings: WorldInfoSettings;
  books: WorldInfoBook[];
  persona: Persona;
  maxContext: number;
  tokenizer: Tokenizer;
};
