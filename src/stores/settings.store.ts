import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { SendOnEnterOptions, DEFAULT_SAVE_EDIT_TIMEOUT } from '../constants';
import { isMobile } from '../utils/browser';
import { debounce } from '../utils/common';
import type { Settings, SettingDefinition } from '../types';
import { fetchUserSettings, saveUserSettings } from '../api/settings';
import { settingsDefinition } from '../settings-definition';
import { toast } from '../composables/useToast';
import { set, get, defaultsDeep } from 'lodash-es';
import { useUiStore } from './ui.store';
import type { Path, ValueForPath } from '../types/utils';

// --- Create type aliases for convenience ---
type SettingsPath = Path<Settings>;
type SettingsValue<P extends SettingsPath> = ValueForPath<Settings, P>;
// -----------------------------------------

function createDefaultSettings(): Settings {
  const defaultSettings: Record<string, any> = {};
  for (const def of settingsDefinition) {
    set(defaultSettings, def.id, def.defaultValue);
  }
  return defaultSettings as Settings;
}

export const useSettingsStore = defineStore('settings', () => {
  // Initialize the store with a default state to prevent race conditions.
  const settings = ref<Settings>(createDefaultSettings());
  const settingsInitializing = ref(true); // Start in an initializing state.
  const definitions = ref<SettingDefinition[]>(settingsDefinition);

  const powerUser = computed(() => settings.value.power_user);

  const shouldSendOnEnter = computed(() => {
    switch (settings.value.power_user.send_on_enter) {
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
    // The 'as' cast is safe here because we've constrained P to be a valid path.
    return get(settings.value, id, definition?.defaultValue) as SettingsValue<P>;
  }

  function setSetting<P extends SettingsPath>(id: P, value: SettingsValue<P>) {
    set(settings.value, id, value);
    saveSettingsDebounced();
  }

  async function initializeSettings() {
    if (!settingsInitializing.value) return;

    try {
      const userSettings = await fetchUserSettings();
      const defaultSettings = createDefaultSettings();

      settings.value = defaultsDeep(userSettings, defaultSettings);
      const uiStore = useUiStore();
      uiStore.activePlayerName = settings.value.username || null;
      uiStore.activePlayerAvatar = settings.value.user_avatar || null;
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

  const saveSettingsDebounced = debounce(() => {
    if (settingsInitializing.value) return;
    saveUserSettings(settings.value);
  }, DEFAULT_SAVE_EDIT_TIMEOUT);

  return {
    settings,
    definitions,
    powerUser,
    shouldSendOnEnter,
    saveSettingsDebounced,
    initializeSettings,
    settingsInitializing,
    getSetting,
    setSetting,
  };
});
