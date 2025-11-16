import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  SendOnEnterOptions,
  DEFAULT_SAVE_EDIT_TIMEOUT,
  defaultPrompts,
  defaultPromptOrder,
  defaultSamplerSettings,
} from '../constants';
import { isMobile } from '../utils/browser';
import { debounce } from '../utils/common';
import {
  type Settings,
  type LegacySettings,
  type SettingDefinition,
  type SettingsPath,
  type AccountStorageKey,
  type Persona,
} from '../types';
import {
  fetchUserSettings,
  saveUserSettings as apiSaveUserSettings,
  type ParsedUserSettingsResponse,
} from '../api/settings';
import { settingsDefinition } from '../settings-definition';
import { toast } from '../composables/useToast';
import { set, get, defaultsDeep } from 'lodash-es';
import { useUiStore } from './ui.store';
import type { ValueForPath } from '../types/utils';
import { defaultWorldInfoSettings } from './world-info.store';
import { migratePreset, saveExperimentalPreset } from '../api/presets';

// --- Create type aliases for convenience ---
type SettingsValue<P extends SettingsPath> = ValueForPath<Settings, P>;
// -----------------------------------------

function createDefaultSettings(): Settings {
  // @ts-ignore
  const defaultSettings: Settings = {};
  for (const def of settingsDefinition) {
    // This now correctly sets nested properties based on the new structure
    set(defaultSettings, def.id, def.defaultValue);
  }

  // Manually set complex default objects that aren't in settingsDefinition
  defaultSettings.api = {
    main: 'openai',
    chat_completion_source: 'openai',
    openai_model: 'gpt-4o',
    claude_model: 'claude-3-5-sonnet-20240620',
    openrouter_model: 'OR_Website',
    reverse_proxy: '',
    proxy_password: '',
    selected_sampler: 'Default',
    samplers: {
      temperature: 1.0,
      frequency_penalty: 0,
      presence_penalty: 0,
      top_p: 1,
      top_k: 0,
      top_a: 0,
      min_p: 0,
      max_context: 16384,
      max_tokens: 500,
      stream: true,
      prompts: defaultPrompts,
      prompt_order: defaultPromptOrder,
    },
  };
  defaultSettings.worldInfo = defaultWorldInfoSettings;
  defaultSettings.account = {};
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

  const migrated: Settings = {
    ui: {
      background: {
        ...(legacy.background || {}),
      },
      avatars: {
        zoomedMagnification: p.zoomed_avatar_magnification,
        neverResize: p.never_resize_avatars,
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
      openai_model: oai.openai_model,
      claude_model: oai.claude_model,
      openrouter_model: oai.openrouter_model,
      reverse_proxy: oai.reverse_proxy,
      proxy_password: oai.proxy_password,
      selected_sampler: oai.preset_settings_openai,
      samplers: {
        temperature: oai.temp_openai || defaultSamplerSettings.temperature,
        frequency_penalty: oai.freq_pen_openai || defaultSamplerSettings.frequency_penalty,
        presence_penalty: oai.pres_pen_openai || defaultSamplerSettings.presence_penalty,
        top_p: oai.top_p_openai || defaultSamplerSettings.top_p,
        top_k: oai.top_k_openai || defaultSamplerSettings.top_k,
        top_a: oai.top_a_openai || defaultSamplerSettings.top_a,
        min_p: oai.min_p_openai || defaultSamplerSettings.min_p,
        max_context: oai.openai_max_context || defaultSamplerSettings.max_context,
        max_context_unlocked: oai.max_context_unlocked || defaultSamplerSettings.max_context_unlocked,
        max_tokens: oai.openai_max_tokens || defaultSamplerSettings.max_tokens,
        stream: oai.stream_openai ?? defaultSamplerSettings.stream,
        prompts: oai.prompts ?? defaultSamplerSettings.prompts,
        prompt_order: oai.prompt_order?.[0] ?? defaultSamplerSettings.prompt_order,
      },
    },
    worldInfo: legacy.world_info_settings,
    account: legacy.account_storage,
  };
  return migrated;
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>(createDefaultSettings());
  const settingsInitializing = ref(true);
  const definitions = ref<SettingDefinition[]>(settingsDefinition);
  // Keep a copy of the full legacy settings to preserve unsused fields on save
  const fullLegacySettings = ref<LegacySettings | null>(null);

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
      Promise.resolve().then(() => {
        settingsInitializing.value = false;
      });
    }
  }

  const saveSettingsDebounced = debounce(async () => {
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
