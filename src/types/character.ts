import type { MessageRole, StrictOmitString } from './common';

export interface CharacterBookEntry {
  id?: number;
  keys?: string[];
  secondary_keys?: string[];
  comment?: string;
  content?: string;
  constant?: boolean;
  selective?: boolean;
  insertion_order?: number;
  enabled?: boolean;
  position?: 'before_char' | 'after_char';
  use_regex?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extensions?: Record<string, any>;
}

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extensions?: Record<string, any>;
  entries: CharacterBookEntry[];
}

export interface Character {
  fav?: boolean | string;
  create_date?: string;
  talkativeness?: number;
  name: string;
  avatar: string; // unique avatar filename
  description?: string;
  first_mes?: string;
  scenario?: string;
  personality?: string;
  mes_example?: string;
  tags?: string[];
  chat?: string;
  shallow?: boolean;
  data?: {
    alternate_greetings?: string[];
    creator_notes?: string;
    creator?: string;
    character_version?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    depth_prompt?: {
      prompt: string;
      depth: number;
      role: StrictOmitString<MessageRole, 'tool'>;
    };
    character_book?: CharacterBook;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extensions?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } & Record<string, any>;
}
