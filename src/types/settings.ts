import {
  ReasoningEffort,
  type OpenrouterMiddleoutType,
  type SendOnEnterOptions,
  type TagImportSetting,
  type TokenizerType,
} from '../constants';
import type { ChatCompletionSource, ConnectionProfile } from './api';
import type { BackgroundFitting, MessageRole } from './common';
import type { I18nKey } from './i18n';
import type { Persona } from './persona';
import type { Path } from './utils';
import type { WorldInfoSettings } from './world-info';

export type SettingsPath = Path<Settings>;
export type OaiSettingsPath = Path<LegacyOaiSettings>;

export interface Prompt {
  name: string;
  system_prompt: boolean;
  role?: MessageRole;
  content?: string;
  identifier: string;
  marker?: boolean;
}

export interface PromptOrderConfig {
  order: {
    identifier: string;
    enabled: boolean;
  }[];
}

export interface ProviderSettings {
  claude: {
    use_sysprompt?: boolean;
    assistant_prefill?: string;
  };
  // vertexai and makersuite
  google: {
    use_makersuite_sysprompt?: boolean;
  };
}

export interface SamplerSettings {
  temperature: number;
  frequency_penalty: number;
  presence_penalty: number;
  repetition_penalty: number;
  top_p: number;
  top_k: number;
  top_a: number;
  min_p: number;
  max_context: number;
  max_context_unlocked?: boolean;
  max_tokens: number;
  stream: boolean;
  seed: number;
  stop: string[];
  n: number;
  prompts: Prompt[];
  prompt_order: PromptOrderConfig;
  providers: ProviderSettings;
  show_thoughts: boolean;
  reasoning_effort: ReasoningEffort;
}

export interface LegacyOaiSettings {
  chat_completion_source: ChatCompletionSource;
  openai_model?: string;
  claude_model?: string;
  openrouter_model?: string;
  google_model?: string; // makersuite
  mistralai_model?: string;
  groq_model?: string;
  deepseek_model?: string;
  ai21_model?: string;
  aimlapi_model?: string;
  azure_openai_model?: string;
  cohere_model?: string;
  cometapi_model?: string;
  custom_model?: string;
  electronhub_model?: string;
  fireworks_model?: string;
  vertexai_model?: string;
  moonshot_model?: string;
  nanogpt_model?: string;
  perplexity_model?: string;
  pollinations_model?: string;
  xai_model?: string;
  zai_model?: string;
  reverse_proxy: string;
  proxy_password: string;
  custom_url?: string;
  azure_base_url?: string;
  azure_deployment_name?: string;
  azure_api_version?: string;
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
  n?: number;
  seed?: number;
  openai_max_context?: number;
  max_context_unlocked?: boolean;
  openai_max_tokens?: number;
  prompts?: Prompt[];
  prompt_order?: {
    character_id: number;
    order: { identifier: string; enabled: boolean }[];
  }[];
  show_thoughts?: boolean;
  reasoning_effort?: ReasoningEffort;
  claude_use_sysprompt?: boolean;
  claude_assistant_prefill?: string;
  use_makersuite_sysprompt?: boolean;
  openrouter_allow_fallbacks?: boolean;
  openrouter_middleout?: boolean;
  openrouter_use_fallback?: boolean;
  openrouter_providers?: string[];
}

export interface LegacyOaiPresetSettings {
  chat_completion_source: ChatCompletionSource;
  openai_model?: string;
  claude_model?: string;
  openrouter_model?: string;
  google_model?: string;
  mistralai_model?: string;
  groq_model?: string;
  deepseek_model?: string;
  ai21_model?: string;
  aimlapi_model?: string;
  azure_openai_model?: string;
  cohere_model?: string;
  cometapi_model?: string;
  custom_model?: string;
  electronhub_model?: string;
  fireworks_model?: string;
  vertexai_model?: string;
  moonshot_model?: string;
  nanogpt_model?: string;
  perplexity_model?: string;
  pollinations_model?: string;
  xai_model?: string;
  zai_model?: string;
  reverse_proxy: string;
  proxy_password: string;
  temperature?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  top_p?: number;
  top_k?: number;
  top_a?: number;
  min_p?: number;
  repetition_penalty?: number;
  stream_openai?: boolean;
  openai_max_context?: number;
  max_context_unlocked?: boolean;
  openai_max_tokens?: number;
  seed?: number;
  n?: number;
  prompts?: Prompt[];
  prompt_order?: {
    character_id: number;
    order: { identifier: string; enabled: boolean }[];
  }[];
  show_thoughts?: boolean;
  reasoning_effort?: ReasoningEffort;
  claude_use_sysprompt?: boolean;
  assistant_prefill?: string;
  use_makersuite_sysprompt?: boolean;
  openrouter_allow_fallbacks?: boolean;
  openrouter_middleout?: boolean;
  openrouter_use_fallback?: boolean;
  openrouter_providers?: string[];
}

export type AccountStorageKey =
  | 'character_browser_collapsed'
  | 'character_browser_width'
  | 'worldinfo_browser_width'
  | 'world_info_sort_order'
  | 'extensions_browser_width';

export type AccountStorageState = Partial<Record<AccountStorageKey, string>>;

export interface Settings {
  ui: {
    background: {
      name: string;
      url: string;
      fitting: BackgroundFitting;
      thumbnailColumns: number;
      animation: boolean;
    };
    avatars: {
      zoomedMagnification: boolean;
      neverResize: boolean;
    };
    chat: {
      reasoningCollapsed: boolean;
    };
  };
  chat: {
    sendOnEnter: SendOnEnterOptions;
    confirmMessageDelete: boolean;
  };
  character: {
    spoilerFreeMode: boolean;
    worldImportDialog: boolean;
    tagImportSetting: TagImportSetting;
  };
  persona: {
    showNotifications: boolean;
    allowMultiConnections: boolean;
    autoLock: boolean;
    defaultPersonaId: string | null;
    personas: Persona[];
  };
  api: {
    main: string;
    chat_completion_source: ChatCompletionSource;
    reverse_proxy: string;
    proxy_password: string;
    selected_sampler?: string;
    samplers: SamplerSettings;
    connection_profiles: ConnectionProfile[];
    selected_connection_profile?: string;
    selected_provider_models: Record<ChatCompletionSource, string>;
    tokenizer: TokenizerType;
    provider_specific: {
      openrouter: {
        use_fallback: boolean;
        providers: string[];
        allow_fallbacks: boolean;
        middleout: OpenrouterMiddleoutType;
      };
      custom: {
        url: string;
      };
      azure_openai: {
        base_url: string;
        deployment_name: string;
        api_version: string;
      };
    };
  };
  worldInfo: WorldInfoSettings;
  account: AccountStorageState;
  disabledExtensions: string[];
  extensionSettings: Record<string, Record<string, any>>;
}

export interface LegacySettings {
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
    personas: Record<string, string>;
    default_persona: string | null;
    persona_descriptions: Record<string, Omit<Persona, 'avatarId' | 'name'>>;
    persona_show_notifications: boolean;
    persona_allow_multi_connections: boolean;
    persona_auto_lock: boolean;
  };
  background: {
    name: string;
    url: string;
    fitting: BackgroundFitting;
    thumbnailColumns: number;
    animation: boolean;
  };
  oai_settings: LegacyOaiSettings;
  world_info_settings: WorldInfoSettings;
  account_storage: AccountStorageState;
  username?: string;
  user_avatar?: string;
  main_api?: string;
  extension_settings?: {
    connectionManager?: {
      profiles?: Record<string, { id: string; mode: 'cc' | 'tc'; api: ChatCompletionSource; model: string }>;
      selected?: string;
    };
  };
  v2Experimental?: Settings;
}

export type SettingType = 'boolean' | 'number' | 'string' | 'enum';
export type SettingWidget = 'checkbox' | 'slider' | 'select' | 'text' | 'textarea';

export interface SettingOption {
  value: string | number;
  label: I18nKey;
}

export interface SettingDefinition {
  id: SettingsPath;
  label: I18nKey;
  description?: I18nKey;
  category: string;
  type: SettingType;
  widget: SettingWidget;
  defaultValue: any;
  min?: number;
  max?: number;
  step?: number;
  options?: SettingOption[];
}
