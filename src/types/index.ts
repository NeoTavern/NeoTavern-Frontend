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
  creatorcomment?: string;
  json_data?: string;
  chat?: string;
  shallow?: boolean;
  data?: {
    alternate_greetings?: string[];
    creator_notes?: string;
  } & Record<string, any>;
}

export interface Group {
  disabled_members?: Array<string>;
  chats: string[];
  members: Array<Character['name']>;
  past_metadata?: Record<string, any>;
  id: string;
  chat_id: string;
}

export interface Tag {
  id: string;
  name: string;
  folder_type?: string;
  filter_state?: string;
  sort_order?: number;
  color?: string;
  color2?: string;
  create_date?: number;
  is_hidden_on_character_card?: boolean;
  action?: Function;
  class?: string;
  icon?: string;
  title?: string;
}

export interface Entity {
  item: Character | Tag | Group;
  id: string | number;
  type: 'character' | 'tag' | 'group';
  entities?: Entity[];
  hidden?: number;
  isUseless?: boolean;
}

export interface ChatMessage {
  send_date?: string;
  name: string;
  mes: string;
  gen_started?: string;
  gen_finished?: string;
  is_user?: boolean;
  is_system?: boolean;
  force_avatar?: string;
  original_avatar?: string;
  swipes?: string[];
  swipe_info?: Record<string, any>;
  swipe_id?: number;
  extra?: {
    reasoning?: string;
    reasoning_duration?: number;
    reasoning_type?: string;
    display_text?: string;
    reasoning_display_text?: string;
    tool_invocations?: any[];
    append_title?: boolean;
    title?: string;
    isSmallSys?: boolean;
    token_count?: number;
  } & Record<string, any>;
}

export interface ExtensionPrompt {
  value: string;
  position: number;
  depth: number;
  scan: boolean;
  filter: () => boolean | Promise<boolean>;
}
export interface CreateSave {
  name: string;
  description: string;
  creator_notes: string;
  post_history_instructions: string;
  character_version: string;
  system_prompt: string;
  tags: string;
  creator: string;
  personality: string;
  first_message: string;
  avatar: FileList | null;
  scenario: string;
  mes_example: string;
  world: string;
  talkativeness: number;
  alternate_greetings: any[];
  depth_prompt_prompt: string;
  depth_prompt_depth: number;
  depth_prompt_role: string;
  extensions: Record<string, any>;
  extra_books: any[];
}

export type MenuType = 'character_edit' | 'characters' | 'settings' | 'create' | 'group_chats';
export type ThumbnailType = 'bg' | 'avatar' | 'persona';

// --- Popup Types ---
export enum POPUP_TYPE {
  TEXT = 1,
  CONFIRM = 2,
  INPUT = 3,
  DISPLAY = 4,
  CROP = 5,
}

export enum POPUP_RESULT {
  AFFIRMATIVE = 1,
  NEGATIVE = 0,
  CANCELLED = -1,
}

export interface CustomPopupButton {
  text: string;
  result?: number;
  classes?: string[] | string;
  action?: () => void;
}

export interface CustomPopupInput {
  id: string;
  label: string;
  tooltip?: string;
  defaultState?: boolean | string;
  type?: 'checkbox' | 'text';
}

export interface PopupOptions {
  okButton?: string | boolean;
  cancelButton?: string | boolean;
  rows?: number;
  wide?: boolean;
  large?: boolean;
  customButtons?: CustomPopupButton[];
  customInputs?: CustomPopupInput[];
  defaultResult?: number;
}
