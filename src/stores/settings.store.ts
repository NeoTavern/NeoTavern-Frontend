import { cloneDeep, get, set } from 'lodash-es';
import { defineStore } from 'pinia';
import { computed, nextTick, ref } from 'vue';
import { fetchAllSamplerPresets } from '../api/presets';
import { fetchNeoSettings, fetchUserSettings, saveNeoSettings } from '../api/settings';
import { useAutoSave } from '../composables/useAutoSave';
import { useMobile } from '../composables/useMobile';
import { toast } from '../composables/useToast';
import { SendOnEnterOptions } from '../constants';
import {
  createDefaultSettings,
  mergeWithDefaults,
  migrateLegacyUserSettings,
  migrateSettings,
} from '../services/settings-migration.service';
import { settingsDefinition } from '../settings-definition';
import { type SettingDefinition, type Settings, type SettingsPath } from '../types';
import type { ValueForPath } from '../types/utils';
import { eventEmitter } from '../utils/extensions';

type SettingsValue<P extends SettingsPath> = ValueForPath<Settings, P>;

export const useSettingsStore = defineStore('settings', () => {
  const { isDeviceMobile } = useMobile();

  const settings = ref<Settings>(createDefaultSettings());
  const settingsInitializing = ref(true);
  const definitions = ref<SettingDefinition[]>(settingsDefinition);

  let initializationPromise: Promise<void> | null = null;

  const { trigger: saveSettingsDebounced } = useAutoSave(async () => {
    if (settingsInitializing.value) return;

    await saveNeoSettings(settings.value);
  });

  function getSetting<P extends SettingsPath>(id: P): SettingsValue<P> {
    const definition = definitions.value.find((def) => def.id === id);
    return get(settings.value, id, definition?.defaultValue) as SettingsValue<P>;
  }

  function setSetting<P extends SettingsPath>(id: P, value: SettingsValue<P>) {
    const oldValue = cloneDeep(get(settings.value, id));
    set(settings.value, id, value);

    nextTick(async () => {
      await eventEmitter.emit('setting:changed', id, value, oldValue);
    });
  }

  const shouldSendOnEnter = computed(() => {
    switch (settings.value.chat.sendOnEnter) {
      case SendOnEnterOptions.DISABLED:
        return false;
      case SendOnEnterOptions.AUTO:
        return !isDeviceMobile.value;
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
        let currentSettings: Settings;
        // 1. Fetch existing Neo settings
        const neoSettings = await fetchNeoSettings();

        if (Object.keys(neoSettings).length > 0) {
          // Case A: Existing NeoTavern User (Versioned or Unversioned)
          // We merge with defaults to ensure missing fields (like 'version' for old users) are populated.
          // This implicitly upgrades "v0" (unversioned) settings to "v1" (default version).
          const { settings: merged } = mergeWithDefaults(neoSettings);
          currentSettings = merged;
        } else {
          // Case B: New User or First-time Migration
          console.warn('No Neo settings found, attempting migration from Legacy settings.');
          try {
            const userSettingsResponse = await fetchUserSettings();
            const neoSamplerPresets = await fetchAllSamplerPresets();
            currentSettings = migrateLegacyUserSettings(userSettingsResponse, neoSamplerPresets);
            // Save immediately after migration so we have a base
            await saveNeoSettings(currentSettings);
          } catch (migrationError) {
            console.error('Legacy migration failed, falling back to defaults:', migrationError);
            currentSettings = createDefaultSettings();
            await saveNeoSettings(currentSettings);
          }
        }

        // 2. Run Version-based Migrations
        // This handles v1 -> v2, etc. in the future.
        const { migrated, hasChanged } = migrateSettings(currentSettings);

        if (hasChanged) {
          console.log('Settings were migrated to a new version. Saving changes.');
          await saveNeoSettings(migrated);
        }

        settings.value = migrated;

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
        settings.value = createDefaultSettings();
        settingsInitializing.value = false;
      } finally {
        initializationPromise = null;
      }
    })();

    return initializationPromise;
  }

  return {
    settings,
    definitions,
    shouldSendOnEnter,
    saveSettingsDebounced,
    initializeSettings,
    settingsInitializing,
    getSetting,
    setSetting,
  };
});
