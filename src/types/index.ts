import type { SendOnEnterOptions, TagImportSetting } from '../constants';

export type MessageRole = 'user' | 'assistant' | 'system';

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
    creator?: string;
    character_version?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    depth_prompt?: {
      prompt: string;
      depth: number;
      role: MessageRole;
    };
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
  swipe_info?: Array<any>;
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

export interface ExtensionManifest {
  name: string;
  display_name: string;
  version?: string;
  author?: string;
  description?: string;
  loading_order?: number;
  requires?: string[]; // extras modules
  dependencies?: string[]; // other extensions
  minimum_client_version?: string;
  js?: string;
  css?: string;
  i18n?: Record<string, string>;
  auto_update?: boolean;
  generate_interceptor?: string;
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

// --- API Connection Types ---
export const chat_completion_sources = {
  OPENAI: 'openai',
  CLAUDE: 'claude',
  OPENROUTER: 'openrouter',
  AI21: 'ai21',
  MAKERSUITE: 'makersuite',
  VERTEXAI: 'vertexai',
  MISTRALAI: 'mistralai',
  CUSTOM: 'custom',
  COHERE: 'cohere',
  PERPLEXITY: 'perplexity',
  GROQ: 'groq',
  ELECTRONHUB: 'electronhub',
  NANOGPT: 'nanogpt',
  DEEPSEEK: 'deepseek',
  AIMLAPI: 'aimlapi',
  XAI: 'xai',
  POLLINATIONS: 'pollinations',
  MOONSHOT: 'moonshot',
  FIREWORKS: 'fireworks',
  COMETAPI: 'cometapi',
  AZURE_OPENAI: 'azure_openai',
  ZAI: 'zai',
} as const;

export type ChatCompletionSource = (typeof chat_completion_sources)[keyof typeof chat_completion_sources];

export interface OaiPrompt {
  name: string;
  system_prompt: boolean;
  role?: MessageRole;
  content?: string;
  identifier: string;
  marker?: boolean;
}

export interface OaiPromptOrderConfig {
  character_id: number; // TODO: I think this should be removed.
  order: {
    identifier: string;
    enabled: boolean;
  }[];
}

export interface AiConfigCondition {
  api?: string | string[];
  source?: ChatCompletionSource | ChatCompletionSource[];
  source_not?: ChatCompletionSource | ChatCompletionSource[];
}

// TODO: Some values might change based on model/source, e.g., max tokens
export interface AiConfigItem {
  id?: string; // Corresponds to a key in oaiSettings, e.g., 'temp_openai'
  widget:
    | 'preset-manager'
    | 'slider'
    | 'number-input'
    | 'checkbox'
    | 'select'
    | 'textarea'
    | 'custom-component'
    | 'info-display'
    | 'hr'
    | 'header';
  apiId?: string; // For preset manager to know which API it controls
  label?: string; // i18n key for the label
  description?: string; // i18n key for text below the control
  infoTooltip?: string; // i18n key for the (i) icon
  infoLink?: string; // URL for docs link
  conditions?: AiConfigCondition;

  // For slider/number
  min?: number;
  max?: number;
  step?: number;
  maxUnlockedId?: string;
  unlockLabel?: string;
  unlockTooltip?: string;

  // for select
  options?: { value: string | number; label: string }[];

  // for custom components
  component?: any;

  // For layout
  cssClass?: string;

  // For info-display
  valueGetter?: (apiStore: any) => string;
}

export interface AiConfigSection {
  id: string;
  conditions?: AiConfigCondition;
  items: AiConfigItem[];
}

export interface OaiSettings {
  chat_completion_source: ChatCompletionSource;
  openai_model: string;
  claude_model: string;
  openrouter_model: string;
  reverse_proxy: string;
  proxy_password: string;

  // Generation settings
  preset_settings_openai?: string;
  temp_openai?: number;
  freq_pen_openai?: number;
  pres_pen_openai?: number;
  top_p_openai?: number;
  top_k_openai?: number;
  top_a_openai?: number;
  min_p_openai?: number;
  repetition_penalty_openai?: number;
  stream_openai?: boolean;
  openai_max_context?: number;
  max_context_unlocked?: boolean;
  openai_max_tokens?: number;
  prompts?: OaiPrompt[];
  prompt_order?: OaiPromptOrderConfig[];
  wrap_in_quotes?: boolean;
  continue_prefill?: boolean;
  squash_system_messages?: boolean;
}

// --- Settings Types ---
export type SettingType = 'boolean' | 'number' | 'string' | 'enum';
export type SettingWidget = 'checkbox' | 'slider' | 'select' | 'text' | 'textarea';

export interface SettingOption {
  value: string | number;
  label: string;
}

export interface SettingDefinition {
  id: string; // dot notation path, e.g., 'ui.avatar_style'
  label: string;
  description?: string;
  category: string;
  type: SettingType;
  widget: SettingWidget;
  defaultValue: any;
  min?: number;
  max?: number;
  step?: number;
  options?: SettingOption[];
}

export type BackgroundFitting = 'classic' | 'cover' | 'contain' | 'stretch' | 'center';

export type Settings = {
  power_user: {
    external_media_forbidden_overrides: Array<string>;
    external_media_allowed_overrides: Array<string>;
    forbid_external_media: boolean;
    world_import_dialog: boolean;
    send_on_enter: SendOnEnterOptions;
    never_resize_avatars: boolean;
    spoiler_free_mode: boolean;
    auto_fix_generated_markdown: boolean;
    confirm_message_delete: boolean;
    tag_import_setting: TagImportSetting;
    movingUI: boolean;
    zoomed_avatar_magnification: boolean;
  };
  background: {
    name: string;
    url: string;
    fitting: BackgroundFitting;
    thumbnailColumns: number;
    animation: boolean;
  };
  oai_settings: OaiSettings;
  username?: string;
  user_avatar?: string;
  main_api?: string;
};

export interface ZoomedAvatar {
  id: string; // Unique ID, can be character name or a UUID
  src: string; // Full URL to the image
  charName: string; // To associate with a character
}
