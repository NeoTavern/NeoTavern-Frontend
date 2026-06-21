import { set } from 'lodash-es';
import { saveSamplerPreset, type Preset } from '../api/presets';
import { type ParsedUserSettingsResponse } from '../api/settings';
import {
  CustomPromptPostProcessing,
  defaultAccountSettings,
  defaultPrompts,
  defaultProviderModels,
  defaultProviderSpecific,
  defaultSamplerSettings,
  defaultWorldInfoSettings,
  OpenrouterMiddleoutType,
  SendOnEnterOptions,
  TagImportSetting,
  TokenizerType,
} from '../constants';
import { settingsDefinition } from '../settings-definition';
import {
  api_providers,
  type ConnectionProfile,
  type KnownPromptIdentifiers,
  type LegacyOaiPresetSettings,
  type LegacySettings,
  type LegacyTextCompletionPreset,
  type Persona,
  type Prompt,
  type SamplerSettings,
  type Settings,
} from '../types';
import { mergeWithUndefinedMulti, uuidv4 } from '../utils/commons';
import { runMigrations, type Migration } from '../utils/migration-runner';

export const LATEST_SETTINGS_VERSION = 1;

// =============================================================================
// Migration Registry
// =============================================================================

/**
 * Registry for settings migrations.
 * Add new migration steps here.
 */
const settingsMigrations: Migration<Settings>[] = [
  // Example:
  // { version: 2, migrate: migrateV1ToV2 },
];

/**
 * Applies registered migrations to the main settings object.
 */
export function migrateSettings(settings: Settings): { migrated: Settings; hasChanged: boolean } {
  return runMigrations(settings, settingsMigrations, LATEST_SETTINGS_VERSION);
}

// =============================================================================
// Legacy Helpers (SillyTavern Compatibility)
// =============================================================================

export interface SillyTavernPersonaExport {
  personas?: Record<string, string>;
  persona_descriptions?: Record<
    string,
    {
      description: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connections: any[];
      lorebook?: string;
    }
  >;
}

/**
 * Parses persona data from the SillyTavern export format into a standard Persona array.
 * @param data - The SillyTavern persona data object.
 * @returns An array of Persona objects.
 */
export function migrateSillyTavernPersonas(data: SillyTavernPersonaExport): Persona[] {
  const personas: Persona[] = [];
  const stNames = data.personas ?? {};
  const stDescs = data.persona_descriptions ?? {};
  const allAvatarIds = new Set([...Object.keys(stNames), ...Object.keys(stDescs)]);

  for (const avatarId of allAvatarIds) {
    const desc = stDescs[avatarId];
    personas.push({
      avatarId: avatarId,
      name: stNames[avatarId] ?? '[Unnamed]',
      connections: desc?.connections ?? [],
      description: desc?.description ?? '',
      lorebooks: desc?.lorebook ? [desc.lorebook] : [],
    });
  }
  return personas;
}

export function migrateLegacyTextCompletionPreset(legacyPreset: LegacyTextCompletionPreset): SamplerSettings {
  let dryBreakers: string[] = [];
  if (legacyPreset.dry_sequence_breakers) {
    try {
      dryBreakers = JSON.parse(legacyPreset.dry_sequence_breakers);
    } catch {
      dryBreakers = [legacyPreset.dry_sequence_breakers];
    }
  }

  return {
    temperature: legacyPreset.temp ?? defaultSamplerSettings.temperature,
    frequency_penalty: legacyPreset.freq_pen ?? defaultSamplerSettings.frequency_penalty,
    presence_penalty: legacyPreset.presence_pen ?? defaultSamplerSettings.presence_penalty,
    repetition_penalty: legacyPreset.rep_pen ?? defaultSamplerSettings.repetition_penalty,
    top_p: legacyPreset.top_p ?? defaultSamplerSettings.top_p,
    top_k: legacyPreset.top_k ?? defaultSamplerSettings.top_k,
    top_a: legacyPreset.top_a ?? defaultSamplerSettings.top_a,
    min_p: legacyPreset.min_p ?? defaultSamplerSettings.min_p,
    max_context: legacyPreset.max_length ?? defaultSamplerSettings.max_context,
    max_context_unlocked: defaultSamplerSettings.max_context_unlocked,
    max_tokens: legacyPreset.genamt ?? defaultSamplerSettings.max_tokens,
    stream: defaultSamplerSettings.stream,
    prompts: structuredClone(defaultSamplerSettings.prompts),
    seed: defaultSamplerSettings.seed,
    n: defaultSamplerSettings.n,
    stop: defaultSamplerSettings.stop,
    providers: {
      claude: structuredClone(defaultSamplerSettings.providers.claude),
      google: structuredClone(defaultSamplerSettings.providers.google),
      koboldcpp: {
        rep_pen_range: legacyPreset.rep_pen_range,
        sampler_order: legacyPreset.sampler_order,
        dynatemp_range:
          legacyPreset.dynatemp && legacyPreset.min_temp !== undefined && legacyPreset.max_temp !== undefined
            ? legacyPreset.max_temp - legacyPreset.min_temp
            : undefined,
        dynatemp_exponent: legacyPreset.dynatemp_exponent,
        smoothing_factor: legacyPreset.smoothing_factor,
        mirostat: legacyPreset.mirostat_mode,
        mirostat_tau: legacyPreset.mirostat_tau,
        mirostat_eta: legacyPreset.mirostat_eta,
        grammar: legacyPreset.grammar_string,
        grammar_retain_state: undefined,
        banned_tokens: legacyPreset.banned_tokens
          ? legacyPreset.banned_tokens.split('\n').filter((t) => t.trim())
          : undefined,
        use_default_badwordsids: undefined,
        dry_multiplier: legacyPreset.dry_multiplier,
        dry_base: legacyPreset.dry_base,
        dry_allowed_length: legacyPreset.dry_allowed_length,
        dry_penalty_last_n: legacyPreset.dry_penalty_last_n,
        dry_sequence_breakers: dryBreakers.length > 0 ? dryBreakers : undefined,
        xtc_threshold: legacyPreset.xtc_threshold,
        xtc_probability: legacyPreset.xtc_probability,
        nsigma: legacyPreset.nsigma,
        tfs: legacyPreset.tfs,
        typical: legacyPreset.typical_p,
      },
      ollama: structuredClone(defaultSamplerSettings.providers.ollama),
    },
    show_thoughts: defaultSamplerSettings.show_thoughts,
    reasoning_effort: defaultSamplerSettings.reasoning_effort,
  };
}

export function migrateLegacyOaiPreset(legacyPreset: LegacyOaiPresetSettings): SamplerSettings {
  const migratedPrompts: Prompt[] = [];

  if (legacyPreset.prompts && legacyPreset.prompt_order) {
    const orderConfig = legacyPreset.prompt_order[legacyPreset.prompt_order.length - 1]?.order || [];
    const definitionMap = new Map(legacyPreset.prompts.map((p) => [p.identifier, p]));

    for (const item of orderConfig) {
      const def = definitionMap.get(item.identifier);
      if (def) {
        migratedPrompts.push({
          ...def,
          identifier: def.identifier as KnownPromptIdentifiers,
          content: def.content || '',
          enabled: item.enabled,
          marker: def.marker ?? false,
        });
        definitionMap.delete(item.identifier);
      }
    }
  } else {
    migratedPrompts.push(...structuredClone(defaultSamplerSettings.prompts));
  }

  return {
    temperature: legacyPreset.temperature ?? defaultSamplerSettings.temperature,
    frequency_penalty: legacyPreset.frequency_penalty ?? defaultSamplerSettings.frequency_penalty,
    presence_penalty: legacyPreset.presence_penalty ?? defaultSamplerSettings.presence_penalty,
    repetition_penalty: legacyPreset.repetition_penalty ?? defaultSamplerSettings.repetition_penalty,
    top_p: legacyPreset.top_p ?? defaultSamplerSettings.top_p,
    top_k: legacyPreset.top_k ?? defaultSamplerSettings.top_k,
    top_a: legacyPreset.top_a ?? defaultSamplerSettings.top_a,
    min_p: legacyPreset.min_p ?? defaultSamplerSettings.min_p,
    max_context_unlocked: legacyPreset.max_context_unlocked ?? defaultSamplerSettings.max_context_unlocked,
    max_context: legacyPreset.openai_max_context ?? defaultSamplerSettings.max_context,
    max_tokens: legacyPreset.openai_max_tokens ?? defaultSamplerSettings.max_tokens,
    stream: legacyPreset.stream_openai ?? defaultSamplerSettings.stream,
    prompts: migratedPrompts,
    seed: legacyPreset.seed ?? defaultSamplerSettings.seed,
    n: legacyPreset.n ?? defaultSamplerSettings.n,
    stop: defaultSamplerSettings.stop,
    providers: {
      claude: {
        use_sysprompt: legacyPreset.claude_use_sysprompt,
        assistant_prefill: legacyPreset.assistant_prefill,
      },
      google: {
        use_makersuite_sysprompt: legacyPreset.use_makersuite_sysprompt,
      },
      koboldcpp: structuredClone(defaultSamplerSettings.providers.koboldcpp),
      ollama: structuredClone(defaultSamplerSettings.providers.ollama),
    },
    show_thoughts: legacyPreset.show_thoughts ?? defaultSamplerSettings.show_thoughts,
    reasoning_effort: legacyPreset.reasoning_effort ?? defaultSamplerSettings.reasoning_effort ?? 'auto',
  };
}

function collectPromptsFromLegacyPresets(presets: LegacyOaiPresetSettings[]): Prompt[] {
  const promptMap = new Map<string, Prompt>();

  for (const preset of presets) {
    const prompts = preset.prompts || [];
    for (const prompt of prompts) {
      if (!promptMap.has(prompt.identifier)) {
        const sameNamePrompt = Array.from(promptMap.values()).find((p) => p.name === prompt.name);
        if (sameNamePrompt) {
          continue;
        }
        promptMap.set(prompt.identifier, {
          ...prompt,
          identifier: prompt.identifier as KnownPromptIdentifiers,
          content: prompt.content || '',
          enabled: false,
          marker: prompt.marker ?? false,
        });
      }
    }
  }

  return Array.from(promptMap.values());
}

// =============================================================================
// Default Settings
// =============================================================================

export function createDefaultSettings(): Settings {
  const defaultSettings: Settings = {
    version: LATEST_SETTINGS_VERSION,
    account: defaultAccountSettings,
    api: {
      provider: 'openai',
      formatter: 'chat',
      proxy: {
        id: '',
        url: '',
        password: '',
      },
      selectedSampler: '',
      selectedProviderModels: structuredClone(defaultProviderModels),
      providerSpecific: structuredClone(defaultProviderSpecific),
      samplers: structuredClone(defaultSamplerSettings),
      connectionProfiles: [],
      selectedConnectionProfile: undefined,
      tokenizer: TokenizerType.AUTO,
      customPromptPostProcessing: CustomPromptPostProcessing.NONE,
      imageQuality: 'auto',
      sendMedia: true,
      toolsEnabled: true,
      instructTemplateName: '',
      reasoningTemplateName: '',
    },
    character: {
      spoilerFreeMode: false,
      worldImportDialog: true,
      tagImportSetting: TagImportSetting.ASK,
      customTags: [{ name: 'NT Default', backgroundColor: 'rgba(108, 32, 32, 1)', foregroundColor: null }],
      customTagAssignments: {},
      hideEmbeddedTagsInPanel: true,
      hideEmbeddedTagsInSuggestions: true,
    },
    chat: {
      sendOnEnter: SendOnEnterOptions.AUTO,
      stopOnNameHijack: 'all',
      confirmMessageDelete: true,
      regenerateOnEdit: true,
      mergeToolMessages: false,
      quickActions: {
        disabledActions: [],
        layout: 'row',
        showLabels: true,
        showGroupNames: true,
        showDividers: true,
      },
    },
    disabledExtensions: [],
    disabledTools: [],
    extensionSettings: {},
    persona: {
      activePersonaId: null,
      defaultPersonaId: null,
      personas: [],
      showNotifications: true,
    },
    prompts: defaultPrompts,
    proxies: [],
    ui: {
      background: {
        fitting: 'cover',
        name: 'landscape autumn great tree.jpg',
        thumbnailColumns: 2,
        url: 'url("/backgrounds/landscape%20autumn%20great%20tree.jpg")',
        useCharacterAvatar: false,
      },
      avatars: {
        neverResize: false,
      },
      chat: {
        reasoningCollapsed: true,
        forbidExternalMedia: true,
        messagesToLoad: 100,
      },
      editor: {
        codeMirrorExpanded: false,
        codeMirrorIdentifiers: [],
      },
      disableAnimations: false,
      selectedTheme: 'Default',
      forceMobileMode: false,
    },
    worldInfo: structuredClone(defaultWorldInfoSettings),
  };

  // Populate dynamic default values from settings definitions
  for (const def of settingsDefinition) {
    set(defaultSettings, def.id, def.defaultValue);
  }

  return defaultSettings;
}

// =============================================================================
// Settings Creation & Legacy Migration
// =============================================================================

export function migrateLegacyUserSettings(
  userSettingsResponse: ParsedUserSettingsResponse,
  neoSamplerPresets: Preset<SamplerSettings>[],
): Settings {
  const legacy = userSettingsResponse.settings;
  const p = legacy.power_user || ({} as LegacySettings['power_user']);
  const oai = legacy.oai_settings || ({} as LegacySettings['oai_settings']);

  // --- 1. Preset Migration (Side Effects) ---
  if (
    neoSamplerPresets.length === 0 &&
    Array.isArray(userSettingsResponse.openai_setting_names) &&
    Array.isArray(userSettingsResponse.openai_settings)
  ) {
    userSettingsResponse.openai_setting_names.forEach(async (name: string, i: number) => {
      try {
        await saveSamplerPreset(name, migrateLegacyOaiPreset(userSettingsResponse.openai_settings[i]));
      } catch (e: unknown) {
        console.error(`Failed to parse legacy preset "${name}":`, userSettingsResponse.openai_settings[i]);
        console.error(e);
      }
    });
  }

  if (
    neoSamplerPresets.length === 0 &&
    Array.isArray(userSettingsResponse.textgenerationwebui_preset_names) &&
    Array.isArray(userSettingsResponse.textgenerationwebui_presets)
  ) {
    userSettingsResponse.textgenerationwebui_preset_names.forEach(async (name: string, i: number) => {
      try {
        await saveSamplerPreset(
          name,
          migrateLegacyTextCompletionPreset(userSettingsResponse.textgenerationwebui_presets[i]),
        );
      } catch (e: unknown) {
        console.error(
          `Failed to parse text completion preset "${name}":`,
          userSettingsResponse.textgenerationwebui_presets[i],
        );
        console.error(e);
      }
    });
  }

  // --- 2. Calculate Complex Values ---
  const migratedPersonas = migrateSillyTavernPersonas(p);

  let allPrompts: Prompt[] = [];
  if (Array.isArray(userSettingsResponse.openai_settings)) {
    allPrompts = collectPromptsFromLegacyPresets(userSettingsResponse.openai_settings);
  }

  let defaultMigratedPrompts = defaultPrompts;
  if (oai.preset_settings_openai) {
    defaultMigratedPrompts =
      neoSamplerPresets.find((p) => p.name === oai.preset_settings_openai)?.preset.prompts || defaultPrompts;
  }

  // --- 3. Base on Default Settings ---
  // We clone defaults first, then overwrite with legacy values where they exist.
  // This avoids duplicating the "Default" structure.
  const settings = createDefaultSettings();

  // --- 4. Map Legacy Values ---

  // UI
  if (legacy.background) {
    settings.ui.background.fitting = legacy.background.fitting ?? settings.ui.background.fitting;
    settings.ui.background.name = legacy.background.name ?? settings.ui.background.name;
    settings.ui.background.thumbnailColumns =
      legacy.background.thumbnailColumns ?? settings.ui.background.thumbnailColumns;
    settings.ui.background.url = legacy.background.url ?? settings.ui.background.url;
  }

  settings.ui.avatars.neverResize = p.never_resize_avatars ?? settings.ui.avatars.neverResize;
  settings.ui.chat.forbidExternalMedia = p.forbid_external_media ?? settings.ui.chat.forbidExternalMedia;
  settings.ui.chat.messagesToLoad = p.chat_truncation ?? settings.ui.chat.messagesToLoad;
  settings.ui.disableAnimations = p.reduced_motion ?? settings.ui.disableAnimations;

  // Chat
  settings.chat.sendOnEnter = p.send_on_enter ?? settings.chat.sendOnEnter;
  settings.chat.confirmMessageDelete = p.confirm_message_delete ?? settings.chat.confirmMessageDelete;

  // Character
  settings.character.spoilerFreeMode = p.spoiler_free_mode ?? settings.character.spoilerFreeMode;
  settings.character.worldImportDialog = p.world_import_dialog ?? settings.character.worldImportDialog;
  settings.character.tagImportSetting = p.tag_import_setting ?? settings.character.tagImportSetting;

  if (legacy.tags) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    settings.character.customTags = Object.entries(legacy.tags).map(([_, tag]) => ({
      name: tag.name,
      backgroundColor: tag.color || null,
      foregroundColor: tag.color2 || null,
    }));
  }

  if (legacy.tag_map) {
    settings.character.customTagAssignments = Object.entries(legacy.tag_map).reduce(
      (acc, [tagName, charIds]) => {
        acc[tagName] = charIds.map((id) => id.toString());
        return acc;
      },
      {} as Record<string, string[]>,
    );
  }

  // Persona
  settings.persona.showNotifications = p.persona_show_notifications ?? settings.persona.showNotifications;
  settings.persona.defaultPersonaId = p.default_persona ?? settings.persona.defaultPersonaId;
  settings.persona.personas = migratedPersonas;
  settings.persona.activePersonaId = p.user_avatar || null;

  // Prompts
  if (allPrompts.length > 0) {
    settings.prompts = allPrompts;
  }

  // API
  settings.api.provider = oai.chat_completion_source ?? settings.api.provider;
  settings.api.proxy.url = oai.reverse_proxy || '';
  settings.api.proxy.password = oai.proxy_password || '';
  settings.api.selectedSampler = oai.preset_settings_openai;
  settings.api.customPromptPostProcessing =
    oai.custom_prompt_post_processing ?? settings.api.customPromptPostProcessing;
  settings.api.imageQuality = oai.inline_image_quality ?? settings.api.imageQuality;

  // Map Models
  const mapModel = (key: keyof typeof settings.api.selectedProviderModels, val?: string) => {
    if (val) settings.api.selectedProviderModels[key] = val;
  };
  mapModel('openai', oai.openai_model);
  mapModel('claude', oai.claude_model);
  mapModel('openrouter', oai.openrouter_model);
  mapModel('vertexai', oai.google_model);
  mapModel('makersuite', oai.google_model);
  mapModel('mistralai', oai.mistralai_model);
  mapModel('groq', oai.groq_model);
  mapModel('deepseek', oai.deepseek_model);
  mapModel('ai21', oai.ai21_model);
  mapModel('aimlapi', oai.aimlapi_model);
  mapModel('azure_openai', oai.azure_openai_model);
  mapModel('cohere', oai.cohere_model);
  mapModel('cometapi', oai.cometapi_model);
  mapModel('custom', oai.custom_model);
  mapModel('electronhub', oai.electronhub_model);
  mapModel('fireworks', oai.fireworks_model);
  mapModel('moonshot', oai.moonshot_model);
  mapModel('nanogpt', oai.nanogpt_model);
  mapModel('perplexity', oai.perplexity_model);
  mapModel('pollinations', oai.pollinations_model);
  mapModel('xai', oai.xai_model);
  mapModel('zai', oai.zai_model);
  mapModel('ollama', oai.ollama_model);

  // Provider Specific
  settings.api.providerSpecific.openrouter.allowFallbacks =
    oai.openrouter_allow_fallbacks ?? settings.api.providerSpecific.openrouter.allowFallbacks;
  settings.api.providerSpecific.openrouter.middleout = oai.openrouter_middleout
    ? OpenrouterMiddleoutType.ON
    : OpenrouterMiddleoutType.OFF;
  settings.api.providerSpecific.openrouter.useFallback =
    oai.openrouter_use_fallback ?? settings.api.providerSpecific.openrouter.useFallback;
  settings.api.providerSpecific.openrouter.providers =
    oai.openrouter_providers ?? settings.api.providerSpecific.openrouter.providers;

  settings.api.providerSpecific.custom.url = oai.custom_url ?? '';

  settings.api.providerSpecific.azure_openai.baseUrl =
    oai.azure_base_url ?? settings.api.providerSpecific.azure_openai.baseUrl;
  settings.api.providerSpecific.azure_openai.deploymentName =
    oai.azure_deployment_name ?? settings.api.providerSpecific.azure_openai.deploymentName;
  settings.api.providerSpecific.azure_openai.apiVersion =
    oai.azure_api_version ?? settings.api.providerSpecific.azure_openai.apiVersion;

  settings.api.providerSpecific.vertexai.region = oai.vertexai_region ?? settings.api.providerSpecific.vertexai.region;
  settings.api.providerSpecific.vertexai.auth_mode =
    oai.vertexai_auth_mode ?? settings.api.providerSpecific.vertexai.auth_mode;
  settings.api.providerSpecific.vertexai.express_project_id =
    oai.vertexai_express_project_id ?? settings.api.providerSpecific.vertexai.express_project_id;

  settings.api.providerSpecific.zai.endpoint = oai.zai_endpoint ?? settings.api.providerSpecific.zai.endpoint;

  // Samplers
  const s = settings.api.samplers;
  s.temperature = oai.temp_openai ?? s.temperature;
  s.frequency_penalty = oai.freq_pen_openai ?? s.frequency_penalty;
  s.presence_penalty = oai.pres_pen_openai ?? s.presence_penalty;
  s.top_p = oai.top_p_openai ?? s.top_p;
  s.top_k = oai.top_k_openai ?? s.top_k;
  s.top_a = oai.top_a_openai ?? s.top_a;
  s.min_p = oai.min_p_openai ?? s.min_p;
  s.repetition_penalty = oai.repetition_penalty_openai ?? s.repetition_penalty;
  s.max_context = oai.openai_max_context ?? s.max_context;
  s.max_context_unlocked = oai.max_context_unlocked ?? s.max_context_unlocked;
  s.max_tokens = oai.openai_max_tokens ?? s.max_tokens;
  s.stream = oai.stream_openai ?? s.stream;
  s.prompts = defaultMigratedPrompts;
  s.show_thoughts = oai.show_thoughts ?? s.show_thoughts;
  s.seed = oai.seed ?? s.seed;
  s.n = oai.n ?? s.n;
  s.reasoning_effort = oai.reasoning_effort ?? s.reasoning_effort;

  s.providers.claude.use_sysprompt = oai.claude_use_sysprompt;
  s.providers.claude.assistant_prefill = oai.claude_assistant_prefill;
  s.providers.google.use_makersuite_sysprompt = oai.use_makersuite_sysprompt;

  // Connection Profiles
  if (legacy.extension_settings?.connectionManager?.profiles) {
    settings.api.connectionProfiles = Object.entries(legacy.extension_settings.connectionManager.profiles)
      .map(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ([_name, profile]) => {
          return {
            id: profile.id,
            name: profile.name,
            formatter: profile.mode === 'cc' ? ('chat' as const) : ('text' as const),
            sampler: profile.preset,
            provider: profile.api,
            model: profile.model,
            customPromptPostProcessing: profile['prompt-post-processing'],
            apiUrl: profile['api-url'],
            secretId: profile['secret-id'],
            instructTemplate: profile.instruct,
            reasoningTemplate: profile['reasoning-template'],
          } satisfies ConnectionProfile;
        },
      )
      .filter((profile) => profile.provider !== undefined && Object.values(api_providers).includes(profile.provider));
  }
  settings.api.selectedConnectionProfile = legacy.extension_settings?.connectionManager?.selected;

  // World Info
  if (legacy.world_info_settings) {
    const wi = settings.worldInfo;
    const lwi = legacy.world_info_settings;
    wi.depth = lwi.world_info_depth ?? wi.depth;
    wi.minActivations = lwi.world_info_min_activations ?? wi.minActivations;
    wi.minActivationsDepthMax = lwi.world_info_min_activations_depth_max ?? wi.minActivationsDepthMax;
    wi.budget = lwi.world_info_budget ?? wi.budget;
    wi.includeNames = lwi.world_info_include_names ?? wi.includeNames;
    wi.recursive = lwi.world_info_recursive ?? wi.recursive;
    wi.overflowAlert = lwi.world_info_overflow_alert ?? wi.overflowAlert;
    wi.caseSensitive = lwi.world_info_case_sensitive ?? wi.caseSensitive;
    wi.matchWholeWords = lwi.world_info_match_whole_words ?? wi.matchWholeWords;
    wi.budgetCap = lwi.world_info_budget_cap ?? wi.budgetCap;
    wi.useGroupScoring = lwi.world_info_use_group_scoring ?? wi.useGroupScoring;
    wi.maxRecursionSteps = lwi.world_info_max_recursion_steps ?? wi.maxRecursionSteps;
  }

  // Proxies
  if (legacy.proxies) {
    settings.proxies = legacy.proxies.map((p) => ({
      id: uuidv4(),
      ...p,
    }));
  }

  return settings;
}

export function mergeWithDefaults(
  settings: Settings | Partial<Settings>,
  legacySettings?: LegacySettings,
): { settings: Settings; legacy: LegacySettings } {
  const defaults = createDefaultSettings();
  const mergedSettings = mergeWithUndefinedMulti({}, defaults, settings);
  const legacy = legacySettings || ({} as LegacySettings);

  return { settings: mergedSettings, legacy };
}
