import {
  CharacterSortOption,
  CustomPromptPostProcessing,
  ReasoningEffort,
  WorldInfoSortOption,
  type OpenrouterMiddleoutType,
  type SendOnEnterOptions,
  type TagImportSetting,
  type TokenizerType,
} from '../constants';
import type { ApiProvider, ConnectionProfile } from './api';
import type { BackgroundFitting, MessageRole } from './common';
import type { I18nKey } from './i18n';
import type { Persona, PersonaConnection } from './persona';
import type { Path } from './utils';
import type { LegacyWorldInfoSettings, WorldInfoSettings } from './world-info';

export type SettingsPath = Path<Settings>;
export type OaiSettingsPath = Path<LegacyOaiSettings>;

export type ApiFormatter = 'chat' | 'text';
export type StopOnNameHijack = 'none' | 'single' | 'group' | 'all';

export interface LegacyPrompt {
  name: string;
  system_prompt: boolean;
  role?: MessageRole;
  content?: string;
  identifier: string;
  marker?: boolean;
}

export interface LegacyPromptOrderConfig {
  order: {
    identifier: string;
    enabled: boolean;
  }[];
}

export type KnownPromptIdentifiers =
  | 'chatHistory'
  | 'charDescription'
  | 'charPersonality'
  | 'scenario'
  | 'dialogueExamples'
  | 'worldInfoBefore'
  | 'worldInfoAfter'
  | 'personaDescription'
  | 'jailbreak';
export interface Prompt {
  identifier: string & KnownPromptIdentifiers; // i know
  name: string;
  role?: MessageRole;
  content: string;
  marker: boolean;
  enabled: boolean;
}

export type Proxy = {
  id: string;
  name: string;
  url: string;
  password: string;
};

export interface KoboldCppSettings {
  // Samplers
  rep_pen_range?: number;
  sampler_order?: number[];

  // Dynatemp
  dynatemp_range?: number;
  dynatemp_exponent?: number;
  smoothing_factor?: number;

  // Mirostat
  mirostat?: number;
  mirostat_tau?: number;
  mirostat_eta?: number;

  // Grammar / Banned
  grammar?: string;
  grammar_retain_state?: boolean;
  banned_tokens?: string[];
  use_default_badwordsids?: boolean;

  // DRY
  dry_multiplier?: number;
  dry_base?: number;
  dry_allowed_length?: number;
  dry_penalty_last_n?: number;
  dry_sequence_breakers?: string[];

  // XTC
  xtc_threshold?: number;
  xtc_probability?: number;

  // N-Sigma
  nsigma?: number;

  // TFS
  tfs?: number;
  typical?: number;
}

export interface OllamaSettings {
  num_batch?: number;
  num_keep?: number;
  repeat_last_n?: number;
  tfs_z?: number;
  typical_p?: number;
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
  koboldcpp: KoboldCppSettings;
  ollama: OllamaSettings;
  disabled_fields?: Partial<Record<ApiProvider, string[]>>;
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
  providers: ProviderSettings;
  show_thoughts: boolean;
  reasoning_effort: ReasoningEffort;
  disabled_fields?: string[];
}

export interface ReasoningTemplate {
  name: string;
  prefix: string;
  suffix: string;
  separator: string;
}

export interface LegacyOaiSettings {
  chat_completion_source: ApiProvider;
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
  ollama_model?: string;
  reverse_proxy: string;
  proxy_password: string;
  custom_url?: string;
  azure_base_url?: string;
  azure_deployment_name?: string;
  azure_api_version?: string;
  vertexai_auth_mode?: string;
  vertexai_express_project_id?: string;
  vertexai_region?: string;
  zai_endpoint?: string;
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
  prompts?: LegacyPrompt[];
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
  custom_prompt_post_processing?: CustomPromptPostProcessing;
}

export interface LegacyOaiPresetSettings {
  chat_completion_source: ApiProvider;
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
  ollama_model?: string;
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
  prompts?: LegacyPrompt[];
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

export type CodeMirrorTarget =
  | 'character.description'
  | 'character.first_mes'
  | 'character.personality'
  | 'character.scenario'
  | 'character.note'
  | 'character.mes_example'
  | 'character.post_history_instructions'
  | 'character.creator_notes'
  | 'character.alternate_greeting'
  | 'persona.description'
  | 'world_info.content'
  | 'prompt.content'
  | 'chat.input'
  | 'chat.edit_message'
  | 'theme.custom_css';

export interface Settings {
  ui: {
    background: {
      name: string;
      url: string;
      fitting: BackgroundFitting;
      thumbnailColumns: number;
    };
    avatars: {
      neverResize: boolean;
    };
    chat: {
      reasoningCollapsed: boolean;
      forbidExternalMedia: boolean;
      messagesToLoad: number;
    };
    editor: {
      codeMirrorIdentifiers: CodeMirrorTarget[];
      codeMirrorExpanded: boolean;
    };
    disableAnimations: boolean;
    selectedTheme: string;
    forceMobileMode: boolean;
  };
  chat: {
    sendOnEnter: SendOnEnterOptions;
    confirmMessageDelete: boolean;
    stopOnNameHijack: StopOnNameHijack;
  };
  character: {
    spoilerFreeMode: boolean;
    worldImportDialog: boolean;
    tagImportSetting: TagImportSetting;
  };
  persona: {
    showNotifications: boolean;
    defaultPersonaId: string | null;
    activePersonaId: string | null;
    personas: Persona[];
  };
  prompts: Prompt[];
  api: {
    provider: ApiProvider;
    proxy: Omit<Proxy, 'name'>;
    selectedSampler?: string;
    samplers: SamplerSettings;
    connectionProfiles: ConnectionProfile[];
    selectedConnectionProfile?: string;
    selectedProviderModels: Record<ApiProvider, string>;
    tokenizer: TokenizerType;

    formatter: ApiFormatter;
    instructTemplateName?: string;
    reasoningTemplateName?: string;
    customPromptPostProcessing: CustomPromptPostProcessing;

    providerSpecific: {
      openrouter: {
        useFallback: boolean;
        providers: string[];
        allowFallbacks: boolean;
        middleout: OpenrouterMiddleoutType;
      };
      custom: {
        url: string;
        include_body?: string; // YAML
        exclude_body?: string[];
        include_headers?: Record<string, string>;
      };
      azure_openai: {
        baseUrl: string;
        deploymentName: string;
        apiVersion: string;
      };
      vertexai: {
        region?: string;
        express_project_id?: string;
        auth_mode?: string;
      };
      zai: {
        endpoint?: string;
      };
      koboldcpp: {
        url: string;
      };
      ollama: {
        url: string;
      };
    };
  };
  worldInfo: WorldInfoSettings;
  proxies: Proxy[];
  account: {
    characterBrowserExpanded: boolean;
    characterBrowserWidth: number;
    worldinfoBrowserWidth: number;
    personaBrowserWidth: number;
    personaBrowserExpanded: boolean;
    characterSortOrder: CharacterSortOption;
    worldInfoSortOrder: WorldInfoSortOption;
    extensionsBrowserWidth: number;
    chatFullScreen: boolean;
    recentChatsPageSize: number;

    addMemberPageSize: number;
    addMemberExpanded: boolean;
    groupMembersExpanded: boolean;
    groupConfigExpanded: boolean;

    rightSidebarWidth: number;
    leftSidebarWidth: number;
    rightSidebarExpanded: boolean;
    leftSidebarExpanded: boolean;
    splitPaneDefaultsMigrated: boolean;
  };
  disabledExtensions: string[];
  extensionSettings: Record<string, Record<string, never>>;
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
    user_avatar?: string;
    persona_descriptions: Record<
      string,
      {
        description: string;
        lorebook: string;
        connections: PersonaConnection[];
        title: string;
      }
    >;
    persona_show_notifications: boolean;
    persona_allow_multi_connections: boolean;
    persona_auto_lock: boolean;
    reduced_motion: boolean;
    reasoning?: ReasoningTemplate;
  };
  background: {
    name: string;
    url: string;
    fitting: BackgroundFitting;
    thumbnailColumns: number;
    animation: boolean;
  };
  oai_settings: LegacyOaiSettings;
  world_info_settings: LegacyWorldInfoSettings;
  username?: string;
  user_avatar?: string;
  main_api?: string;
  proxies?: Omit<Proxy, 'id'>[];
  extension_settings?: {
    connectionManager?: {
      profiles?: Record<
        string,
        {
          id: string;
          mode: 'cc' | 'tc';
          api?: ApiProvider;
          model?: string;
          preset?: string;
          name: string;
          'prompt-post-processing'?: CustomPromptPostProcessing;
          'api-url'?: string;
          'secret-id'?: string;
          instruct?: string;
          'reasoning-template'?: string;
        }
      >;
      selected?: string;
    };
  };
}

export type SettingType = 'boolean' | 'number' | 'string' | 'enum';
export type SettingWidget = 'checkbox' | 'slider' | 'select' | 'text' | 'textarea';

export interface SettingOption {
  value: string | number;
  label: I18nKey;
}

export interface GroupedSettingOption {
  label: I18nKey;
  options: SettingOption[];
}

export interface SettingDefinition {
  id: SettingsPath;
  label: I18nKey;
  description?: I18nKey;
  category: string;
  type: SettingType;
  widget: SettingWidget;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultValue: any;
  min?: number;
  max?: number;
  step?: number;
  options?: SettingOption[] | GroupedSettingOption[];
  multiple?: boolean;
  searchable?: boolean;
  groupSelect?: boolean;
  showOn?: 'all' | 'mobileDevice' | 'desktopDevice';
}
