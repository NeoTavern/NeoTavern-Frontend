import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import {
  SendOnEnterOptions,
  DEFAULT_SAVE_EDIT_TIMEOUT,
  defaultSamplerSettings,
  defaultProviderModels,
  OpenrouterMiddleoutType,
} from '../constants';
import { isMobile } from '../utils/browser';
import {
  type Settings,
  type LegacySettings,
  type SettingDefinition,
  type SettingsPath,
  type AccountStorageKey,
  type Persona,
  type ConnectionProfile,
} from '../types';
import {
  fetchUserSettings,
  saveUserSettings as apiSaveUserSettings,
  type ParsedUserSettingsResponse,
} from '../api/settings';
import { settingsDefinition } from '../settings-definition';
import { toast } from '../composables/useToast';
import { set, get, defaultsDeep, debounce, type DebouncedFunc, cloneDeep } from 'lodash-es';
import { useUiStore } from './ui.store';
import type { ValueForPath } from '../types/utils';
import { defaultWorldInfoSettings } from './world-info.store';
import { migratePreset, saveExperimentalPreset } from '../api/presets';
import { eventEmitter } from '../utils/event-emitter';

type SettingsValue<P extends SettingsPath> = ValueForPath<Settings, P>;

// TODO: We should simply define all default settings, then override with settingsDefinition defaults.
function createDefaultSettings(): Settings {
  // @ts-ignore
  const defaultSettings: Settings = {};
  for (const def of settingsDefinition) {
    set(defaultSettings, def.id, def.defaultValue);
  }

  // Manually set complex default objects that aren't in settingsDefinition
  defaultSettings.api = {
    main: 'openai',
    chat_completion_source: 'openai',
    reverse_proxy: '',
    proxy_password: '',
    selected_sampler: 'Default',
    samplers: defaultSamplerSettings,
    connection_profiles: [],
    selected_connection_profile: undefined,
    selected_provider_models: { ...defaultProviderModels },
    provider_specific: {
      openrouter: {
        allow_fallbacks: true,
        middleout: OpenrouterMiddleoutType.ON,
        use_fallback: false,
        providers: [],
      },
      custom: {
        url: '',
      },
      azure_openai: {
        base_url: '',
        deployment_name: '',
        api_version: '',
      },
    },
  };
  defaultSettings.worldInfo = defaultWorldInfoSettings;
  defaultSettings.account = {};
  defaultSettings.disabledExtensions = [];
  defaultSettings.extensionSettings = {};
  defaultSettings.persona = {
    showNotifications: true,
    allowMultiConnections: false,
    autoLock: false,
    defaultPersonaId: null,
    personas: [],
  };

  return defaultSettings as Settings;
}

function migrateLegacyToExperimental(userSettingsResponse: ParsedUserSettingsResponse): Settings {
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
      ...(oldPersonaDescriptions[avatarId] ?? {}),
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
        await saveExperimentalPreset(name, migratePreset(userSettingsResponse.openai_settings[i]));
      } catch (e) {
        console.error(`Failed to parse legacy preset "${name}":`, userSettingsResponse.openai_settings[i]);
      }
    });
  }

  // Migrate connection profiles
  const migratedConnectionProfiles: ConnectionProfile[] = [];
  const legacyProfiles = legacy.extension_settings?.connectionManager?.profiles ?? {};
  for (const name in legacyProfiles) {
    if (Object.prototype.hasOwnProperty.call(legacyProfiles, name)) {
      migratedConnectionProfiles.push({
        name: name,
        api: legacyProfiles[name].mode === 'cc' ? 'openai' : undefined,
        model: legacyProfiles[name].model,
        id: legacyProfiles[name].id,
        chat_completion_source: legacyProfiles[name].mode === 'cc' ? legacyProfiles[name].api : undefined,
      });
    }
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
      allowMultiConnections: p.persona_allow_multi_connections,
      autoLock: p.persona_auto_lock,
      defaultPersonaId: p.default_persona,
      personas: migratedPersonas,
    },
    api: {
      main: legacy.main_api || 'openai',
      chat_completion_source: oai.chat_completion_source,
      reverse_proxy: oai.reverse_proxy,
      proxy_password: oai.proxy_password,
      selected_sampler: oai.preset_settings_openai,
      selected_provider_models: {
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
      },
      provider_specific: {
        openrouter: {
          allow_fallbacks: oai.openrouter_allow_fallbacks ?? true,
          middleout: oai.openrouter_middleout ? OpenrouterMiddleoutType.ON : OpenrouterMiddleoutType.OFF,
          use_fallback: oai.openrouter_use_fallback ?? false,
          providers: oai.openrouter_providers ?? [],
        },
        custom: {
          url: oai.custom_url ?? '',
        },
        azure_openai: {
          base_url: oai.azure_base_url ?? '',
          deployment_name: oai.azure_deployment_name ?? '',
          api_version: oai.azure_api_version ?? '',
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
        prompts: oai.prompts ?? defaultSamplerSettings.prompts,
        prompt_order: oai.prompt_order?.[0] ?? defaultSamplerSettings.prompt_order,
        show_thoughts: oai.show_thoughts ?? defaultSamplerSettings.show_thoughts,
        seed: oai.seed ?? defaultSamplerSettings.seed,
        n: oai.n ?? defaultSamplerSettings.n,
        stop: defaultSamplerSettings.stop, // There is no `stop` in legacy settings
        providers: {
          claude: {
            use_sysprompt: oai.claude_use_sysprompt,
            assistant_prefill: oai.claude_assistant_prefill,
          },
          google: {
            use_makersuite_sysprompt: oai.use_makersuite_sysprompt,
          },
        },
        reasoning_effort: oai.reasoning_effort ?? defaultSamplerSettings.reasoning_effort,
      },
      connection_profiles: migratedConnectionProfiles,
      selected_connection_profile: legacy.extension_settings?.connectionManager?.selected,
    },
    worldInfo: legacy.world_info_settings,
    account: legacy.account_storage,
    disabledExtensions: [],
    extensionSettings: {}, // Since old extensions not going to work, start fresh
  };
  return migrated;
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>(createDefaultSettings());
  const settingsInitializing = ref(true);
  const definitions = ref<SettingDefinition[]>(settingsDefinition);
  // Keep a copy of the full legacy settings to preserve unsused fields on save
  const fullLegacySettings = ref<LegacySettings | null>(null);

  // Watch for settings changes to emit events
  watch(
    settings,
    (newValue, oldValue) => {
      if (settingsInitializing.value) return;

      const newCloned = cloneDeep(newValue);
      const oldCloned = cloneDeep(oldValue);

      definitions.value.forEach(async (def) => {
        const path = def.id;
        const newVal = get(newCloned, path);
        const oldVal = get(oldCloned, path);
        if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
          await eventEmitter.emit('setting:changed', path, newVal, oldVal);
        }
      });
    },
    { deep: true },
  );

  const shouldSendOnEnter = computed(() => {
    switch (settings.value.chat.sendOnEnter) {
      case SendOnEnterOptions.DISABLED:
        return false;
      case SendOnEnterOptions.AUTO:
        return !isMobile();
      case SendOnEnterOptions.ENABLED:
        return true;
      default:
        return false;
    }
  });

  function getSetting<P extends SettingsPath>(id: P): SettingsValue<P> {
    const definition = definitions.value.find((def) => def.id === id);
    return get(settings.value, id, definition?.defaultValue) as SettingsValue<P>;
  }

  function setSetting<P extends SettingsPath>(id: P, value: SettingsValue<P>) {
    set(settings.value, id, value);
    saveSettingsDebounced();
  }

  // Provides a way to modify legacy settings that haven't been migrated yet (e.g., complex persona objects)
  function setLegacySetting(path: string, value: any) {
    if (fullLegacySettings.value) {
      set(fullLegacySettings.value, path, value);
      saveSettingsDebounced();
    }
  }

  function getAccountItem(key: AccountStorageKey): string | null {
    return settings.value.account?.[key] ?? null;
  }

  function setAccountItem(key: AccountStorageKey, value: string) {
    if (!settings.value.account) {
      settings.value.account = {};
    }
    settings.value.account[key] = value;
    saveSettingsDebounced();
  }

  async function initializeSettings() {
    if (!settingsInitializing.value) return;

    try {
      const userSettingsResponse = await fetchUserSettings();
      const legacySettings = userSettingsResponse.settings;
      fullLegacySettings.value = legacySettings;

      const defaultSettings = createDefaultSettings();
      let experimentalSettings: Settings;

      if (legacySettings.v2Experimental) {
        // If new structure exists, use it but merge with defaults to add any newly defined settings.
        experimentalSettings = defaultsDeep({}, legacySettings.v2Experimental, defaultSettings);
      } else {
        // If not, migrate from legacy structure.
        experimentalSettings = migrateLegacyToExperimental(userSettingsResponse);
        // Then merge with defaults.
        experimentalSettings = defaultsDeep(experimentalSettings, defaultSettings);
      }

      settings.value = experimentalSettings;

      const uiStore = useUiStore();
      uiStore.activePlayerName = legacySettings.username || null;
      uiStore.activePlayerAvatar = legacySettings.user_avatar || null;
    } catch (error) {
      console.error('Failed to initialize settings:', error);
      toast.error('Could not load user settings. Using defaults.');
      // The store already has defaults, so we can just continue safely.
    } finally {
      Promise.resolve().then(async () => {
        settingsInitializing.value = false;
        await eventEmitter.emit('app:loaded');
      });
    }
  }

  const saveSettingsDebounced: DebouncedFunc<() => Promise<void>> = debounce(async () => {
    // TODO: Should we remove our debounce and use lodash's debounce directly?
    if (settingsInitializing.value || !fullLegacySettings.value) return;

    const settingsToSave: LegacySettings = { ...fullLegacySettings.value };
    settingsToSave.v2Experimental = settings.value;

    await apiSaveUserSettings(settingsToSave);
  }, DEFAULT_SAVE_EDIT_TIMEOUT);

  return {
    settings,
    definitions,
    shouldSendOnEnter,
    saveSettingsDebounced,
    initializeSettings,
    settingsInitializing,
    getSetting,
    setSetting,
    setLegacySetting,
    getAccountItem,
    setAccountItem,
  };
});
