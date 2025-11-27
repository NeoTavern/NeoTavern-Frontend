import { cloneDeep, get, set } from 'lodash-es';
import { defineStore } from 'pinia';
import { computed, nextTick, ref } from 'vue';
import { saveUserSettings as apiSaveUserSettings, fetchUserSettings } from '../api/settings';
import { useAutoSave } from '../composables/useAutoSave';
import { toast } from '../composables/useToast';
import { SendOnEnterOptions } from '../constants';
import {
  createDefaultSettings,
  mergeWithDefaults,
  migrateLegacyToExperimental,
} from '../services/settings-migration.service';
import { settingsDefinition } from '../settings-definition';
import { type LegacySettings, type SettingDefinition, type Settings, type SettingsPath } from '../types';
import type { ValueForPath } from '../types/utils';
import { isMobile } from '../utils/client';
import { eventEmitter } from '../utils/extensions';
import { useUiStore } from './ui.store';

type SettingsValue<P extends SettingsPath> = ValueForPath<Settings, P>;

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>(createDefaultSettings());
  const settingsInitializing = ref(true);
  const definitions = ref<SettingDefinition[]>(settingsDefinition);
  const fullLegacySettings = ref<LegacySettings | null>(null);

  let initializationPromise: Promise<void> | null = null;

  const { trigger: saveSettingsDebounced } = useAutoSave(async () => {
    if (settingsInitializing.value || !fullLegacySettings.value) return;

    const settingsToSave: LegacySettings = { ...fullLegacySettings.value };
    settingsToSave.v2Experimental = settings.value;
    await apiSaveUserSettings(settingsToSave);
  });

  function getSetting<P extends SettingsPath>(id: P): SettingsValue<P> {
    const definition = definitions.value.find((def) => def.id === id);
    return get(settings.value, id, definition?.defaultValue) as SettingsValue<P>;
  }

  function setSetting<P extends SettingsPath>(id: P, value: SettingsValue<P>) {
    const oldValue = cloneDeep(get(settings.value, id));
    set(settings.value, id, value);

    nextTick(() => {
      eventEmitter.emit('setting:changed', id, value, oldValue);
    });
  }

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

  async function initializeSettings() {
    if (!settingsInitializing.value) return;
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      try {
        const userSettingsResponse = await fetchUserSettings();
        const legacySettings = userSettingsResponse.settings;
        fullLegacySettings.value = legacySettings;

        let experimentalSettings: Settings;

        if (legacySettings.v2Experimental) {
          const result = mergeWithDefaults(legacySettings.v2Experimental, legacySettings);
          experimentalSettings = result.settings;
        } else {
          experimentalSettings = migrateLegacyToExperimental(userSettingsResponse);
          const result = mergeWithDefaults(experimentalSettings, legacySettings);
          experimentalSettings = result.settings;
        }

        settings.value = experimentalSettings;

        const uiStore = useUiStore();
        uiStore.activePlayerName = legacySettings.username || null;
        uiStore.activePlayerAvatar = legacySettings.user_avatar || null;

        settingsInitializing.value = false;
        await nextTick();
        await eventEmitter.emit('app:loaded');

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        useSettingsStore().$subscribe((mutation, state) => {
          if (!settingsInitializing.value) {
            saveSettingsDebounced();
          }
        });
      } catch (error) {
        console.error('Failed to initialize settings:', error);
        toast.error('Could not load user settings. Using defaults.');
        settingsInitializing.value = false;
      } finally {
        initializationPromise = null;
      }
    })();

    return initializationPromise;
  }

  async function waitForSettings() {
    if (!settingsInitializing.value) return;
    await initializeSettings();
  }

  return {
    settings,
    definitions,
    shouldSendOnEnter,
    saveSettingsDebounced,
    initializeSettings,
    waitForSettings,
    settingsInitializing,
    getSetting,
    setSetting,
  };
});
