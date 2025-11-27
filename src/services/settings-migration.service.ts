import { defaultsDeep, set } from 'lodash-es';
import { saveExperimentalPreset } from '../api/presets';
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
  TokenizerType,
} from '../constants';
import { settingsDefinition } from '../settings-definition';
import {
  type LegacyOaiPresetSettings,
  type LegacySettings,
  type Persona,
  type Prompt,
  type SamplerSettings,
  type Settings,
} from '../types';
import { uuidv4 } from '../utils/commons';

export function createDefaultSettings(): Settings {
  // @ts-expect-error Missing properties initialization, populated via loop and manual assignments
  const defaultSettings: Settings = {};
  for (const def of settingsDefinition) {
    set(defaultSettings, def.id, def.defaultValue);
  }

  // Manually set complex default objects that aren't in settingsDefinition
  defaultSettings.prompts = structuredClone(defaultPrompts);
  defaultSettings.api = {
    provider: 'openai',
    formatter: 'chat',
    proxy: {
      id: '',
      password: '',
      url: '',
    },
    selectedSampler: 'Default',
    samplers: defaultSamplerSettings,
    connectionProfiles: [],
    selectedConnectionProfile: undefined,
    selectedProviderModels: structuredClone(defaultProviderModels),
    tokenizer: TokenizerType.AUTO,
    providerSpecific: structuredClone(defaultProviderSpecific),
    customPromptPostProcessing: CustomPromptPostProcessing.NONE,
  };
  defaultSettings.worldInfo = defaultWorldInfoSettings;
  defaultSettings.account = defaultAccountSettings;
  defaultSettings.disabledExtensions = [];
  defaultSettings.extensionSettings = {};
  defaultSettings.persona = {
    showNotifications: true,
    defaultPersonaId: null,
    personas: [],
  };

  return defaultSettings;
}

export function migrateExperimentalPreset(legacyPreset: LegacyOaiPresetSettings): SamplerSettings {
  // Migrate prompts from legacy ordered config to flat list
  const migratedPrompts: Prompt[] = [];

  if (legacyPreset.prompts && legacyPreset.prompt_order) {
    const orderConfig = legacyPreset.prompt_order[0]?.order || [];
    const definitionMap = new Map(legacyPreset.prompts.map((p) => [p.identifier, p]));

    // 1. Add prompts defined in order
    for (const item of orderConfig) {
      const def = definitionMap.get(item.identifier);
      if (def) {
        migratedPrompts.push({
          ...def,
          content: def.content || '',
          enabled: item.enabled,
          marker: def.marker ?? false,
        });
        definitionMap.delete(item.identifier);
      }
    }
  } else {
    // Fallback to default if no valid legacy data
    migratedPrompts.push(...structuredClone(defaultSamplerSettings.prompts));
  }

  const newPreset: SamplerSettings = {
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
    stop: defaultSamplerSettings.stop, // Legacy don't have it
    providers: {
      claude: {
        use_sysprompt: legacyPreset.claude_use_sysprompt,
        assistant_prefill: legacyPreset.assistant_prefill,
      },
      google: {
        use_makersuite_sysprompt: legacyPreset.use_makersuite_sysprompt,
      },
      koboldcpp: structuredClone(defaultSamplerSettings.providers.koboldcpp),
    },
    show_thoughts: legacyPreset.show_thoughts ?? defaultSamplerSettings.show_thoughts,
    reasoning_effort: legacyPreset.reasoning_effort ?? defaultSamplerSettings.reasoning_effort ?? 'auto',
  };

  return newPreset;
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
          content: prompt.content || '',
          enabled: false,
          marker: prompt.marker ?? false,
        });
      }
    }
  }

  return Array.from(promptMap.values());
}

export function migrateLegacyToExperimental(userSettingsResponse: ParsedUserSettingsResponse): Settings {
  const legacy = userSettingsResponse.settings;
  const p = legacy.power_user || ({} as LegacySettings['power_user']);
  const oai = legacy.oai_settings || ({} as LegacySettings['oai_settings']);

  // Migrate personas from old format to new array format
  const migratedPersonas: Persona[] = [];
  const oldPersonaNames = p.personas ?? {};
  const oldPersonaDescriptions = p.persona_descriptions ?? {};
  const allAvatarIds = new Set([...Object.keys(oldPersonaNames), ...Object.keys(oldPersonaDescriptions)]);

  for (const avatarId of allAvatarIds) {
    migratedPersonas.push({
      avatarId: avatarId,
      name: oldPersonaNames[avatarId] ?? '[Unnamed]',
      connections: oldPersonaDescriptions[avatarId]?.connections ?? [],
      description: oldPersonaDescriptions[avatarId]?.description ?? '',
      lorebooks: [],
      title: oldPersonaDescriptions[avatarId]?.title ?? '',
    } as Persona);
  }

  // Migrate presets
  if (
    userSettingsResponse.v2ExperimentalSamplerPreset_settings.length === 0 &&
    Array.isArray(userSettingsResponse.openai_setting_names) &&
    Array.isArray(userSettingsResponse.openai_settings)
  ) {
    userSettingsResponse.openai_setting_names.forEach(async (name: string, i: number) => {
      try {
        await saveExperimentalPreset(name, migrateExperimentalPreset(userSettingsResponse.openai_settings[i]));
      } catch (e: unknown) {
        console.error(`Failed to parse legacy preset "${name}":`, userSettingsResponse.openai_settings[i]);
        console.error(e);
      }
    });
  }

  let allPrompts: Prompt[] = [];
  if (Array.isArray(userSettingsResponse.openai_settings)) {
    allPrompts = collectPromptsFromLegacyPresets(userSettingsResponse.openai_settings);
  }

  const migrated: Settings = {
    ui: {
      background: {
        ...(legacy.background || {}),
      },
      avatars: {
        zoomedMagnification: p.zoomed_avatar_magnification,
        neverResize: p.never_resize_avatars,
      },
      chat: {
        reasoningCollapsed: false,
      },
    },
    chat: {
      sendOnEnter: p.send_on_enter,
      confirmMessageDelete: p.confirm_message_delete,
    },
    character: {
      spoilerFreeMode: p.spoiler_free_mode,
      worldImportDialog: p.world_import_dialog,
      tagImportSetting: p.tag_import_setting,
    },
    persona: {
      showNotifications: p.persona_show_notifications,
      defaultPersonaId: p.default_persona,
      personas: migratedPersonas,
    },
    prompts: allPrompts,
    api: {
      provider: oai.chat_completion_source,
      formatter: 'chat',
      proxy: {
        id: '',
        url: oai.reverse_proxy || '',
        password: oai.proxy_password || '',
      },
      selectedSampler: oai.preset_settings_openai,
      selectedProviderModels: {
        openai: oai.openai_model || defaultProviderModels.openai,
        claude: oai.claude_model || defaultProviderModels.claude,
        openrouter: oai.openrouter_model || defaultProviderModels.openrouter,
        vertexai: oai.google_model || defaultProviderModels.vertexai,
        makersuite: oai.google_model || defaultProviderModels.makersuite,
        mistralai: oai.mistralai_model || defaultProviderModels.mistralai,
        groq: oai.groq_model || defaultProviderModels.groq,
        deepseek: oai.deepseek_model || defaultProviderModels.deepseek,
        ai21: oai.ai21_model || defaultProviderModels.ai21,
        aimlapi: oai.aimlapi_model || defaultProviderModels.aimlapi,
        azure_openai: oai.azure_openai_model || defaultProviderModels.azure_openai,
        cohere: oai.cohere_model || defaultProviderModels.cohere,
        cometapi: oai.cometapi_model || defaultProviderModels.cometapi,
        custom: oai.custom_model || defaultProviderModels.custom,
        electronhub: oai.electronhub_model || defaultProviderModels.electronhub,
        fireworks: oai.fireworks_model || defaultProviderModels.fireworks,
        moonshot: oai.moonshot_model || defaultProviderModels.moonshot,
        nanogpt: oai.nanogpt_model || defaultProviderModels.nanogpt,
        perplexity: oai.perplexity_model || defaultProviderModels.perplexity,
        pollinations: oai.pollinations_model || defaultProviderModels.pollinations,
        xai: oai.xai_model || defaultProviderModels.xai,
        zai: oai.zai_model || defaultProviderModels.zai,
        koboldcpp: defaultProviderModels.koboldcpp,
      },
      providerSpecific: {
        openrouter: {
          allowFallbacks: oai.openrouter_allow_fallbacks ?? defaultProviderSpecific.openrouter.allowFallbacks,
          middleout: oai.openrouter_middleout ? OpenrouterMiddleoutType.ON : OpenrouterMiddleoutType.OFF,
          useFallback: oai.openrouter_use_fallback ?? defaultProviderSpecific.openrouter.useFallback,
          providers: oai.openrouter_providers ?? defaultProviderSpecific.openrouter.providers,
        },
        custom: {
          url: oai.custom_url ?? '',
        },
        azure_openai: {
          baseUrl: oai.azure_base_url ?? defaultProviderSpecific.azure_openai.baseUrl,
          deploymentName: oai.azure_deployment_name ?? defaultProviderSpecific.azure_openai.deploymentName,
          apiVersion: oai.azure_api_version ?? defaultProviderSpecific.azure_openai.apiVersion,
        },
        vertexai: {
          region: oai.vertexai_region ?? defaultProviderSpecific.vertexai.region,
          auth_mode: oai.vertexai_auth_mode ?? defaultProviderSpecific.vertexai.auth_mode,
          express_project_id: oai.vertexai_express_project_id ?? defaultProviderSpecific.vertexai.express_project_id,
        },
        zai: {
          endpoint: oai.zai_endpoint ?? defaultProviderSpecific.zai.endpoint,
        },
        koboldcpp: {
          url: defaultProviderSpecific.koboldcpp.url,
        },
      },
      samplers: {
        temperature: oai.temp_openai ?? defaultSamplerSettings.temperature,
        frequency_penalty: oai.freq_pen_openai ?? defaultSamplerSettings.frequency_penalty,
        presence_penalty: oai.pres_pen_openai ?? defaultSamplerSettings.presence_penalty,
        top_p: oai.top_p_openai ?? defaultSamplerSettings.top_p,
        top_k: oai.top_k_openai ?? defaultSamplerSettings.top_k,
        top_a: oai.top_a_openai ?? defaultSamplerSettings.top_a,
        min_p: oai.min_p_openai ?? defaultSamplerSettings.min_p,
        repetition_penalty: oai.repetition_penalty_openai ?? defaultSamplerSettings.repetition_penalty,
        max_context: oai.openai_max_context ?? defaultSamplerSettings.max_context,
        max_context_unlocked: oai.max_context_unlocked ?? defaultSamplerSettings.max_context_unlocked,
        max_tokens: oai.openai_max_tokens ?? defaultSamplerSettings.max_tokens,
        stream: oai.stream_openai ?? defaultSamplerSettings.stream,
        prompts: defaultPrompts,
        show_thoughts: oai.show_thoughts ?? defaultSamplerSettings.show_thoughts,
        seed: oai.seed ?? defaultSamplerSettings.seed,
        n: oai.n ?? defaultSamplerSettings.n,
        stop: defaultSamplerSettings.stop,
        providers: {
          claude: {
            use_sysprompt: oai.claude_use_sysprompt,
            assistant_prefill: oai.claude_assistant_prefill,
          },
          google: {
            use_makersuite_sysprompt: oai.use_makersuite_sysprompt,
          },
          koboldcpp: structuredClone(defaultSamplerSettings.providers.koboldcpp),
        },
        reasoning_effort: oai.reasoning_effort ?? defaultSamplerSettings.reasoning_effort,
      },
      connectionProfiles: [],
      selectedConnectionProfile: legacy.extension_settings?.connectionManager?.selected,
      tokenizer: TokenizerType.AUTO,
      customPromptPostProcessing: oai.custom_prompt_post_processing ?? CustomPromptPostProcessing.NONE,
    },
    account: defaultAccountSettings,
    worldInfo: {
      activeBookNames: [],
      depth: legacy.world_info_settings.world_info_depth ?? defaultWorldInfoSettings.depth,
      minActivations: legacy.world_info_settings.world_info_min_activations ?? defaultWorldInfoSettings.minActivations,
      minActivationsDepthMax:
        legacy.world_info_settings.world_info_min_activations_depth_max ??
        defaultWorldInfoSettings.minActivationsDepthMax,
      budget: legacy.world_info_settings.world_info_budget ?? defaultWorldInfoSettings.budget,
      includeNames: legacy.world_info_settings.world_info_include_names ?? defaultWorldInfoSettings.includeNames,
      recursive: legacy.world_info_settings.world_info_recursive ?? defaultWorldInfoSettings.recursive,
      overflowAlert: legacy.world_info_settings.world_info_overflow_alert ?? defaultWorldInfoSettings.overflowAlert,
      caseSensitive: legacy.world_info_settings.world_info_case_sensitive ?? defaultWorldInfoSettings.caseSensitive,
      matchWholeWords:
        legacy.world_info_settings.world_info_match_whole_words ?? defaultWorldInfoSettings.matchWholeWords,
      characterStrategy:
        legacy.world_info_settings.world_info_character_strategy ?? defaultWorldInfoSettings.characterStrategy,
      budgetCap: legacy.world_info_settings.world_info_budget_cap ?? defaultWorldInfoSettings.budgetCap,
      useGroupScoring:
        legacy.world_info_settings.world_info_use_group_scoring ?? defaultWorldInfoSettings.useGroupScoring,
      maxRecursionSteps:
        legacy.world_info_settings.world_info_max_recursion_steps ?? defaultWorldInfoSettings.maxRecursionSteps,
    },
    proxies:
      legacy.proxies?.map((p) => ({
        id: uuidv4(),
        ...p,
      })) || [],
    disabledExtensions: [],
    extensionSettings: {},
  };
  return migrated;
}

export function mergeWithDefaults(
  settings: Settings | Partial<Settings>,
  legacySettings?: LegacySettings,
): { settings: Settings; legacy: LegacySettings } {
  const defaults = createDefaultSettings();
  const mergedSettings = defaultsDeep({}, settings, defaults);
  const legacy = legacySettings || ({} as LegacySettings);

  return { settings: mergedSettings, legacy };
}
