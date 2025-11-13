import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { SendOnEnterOptions, DEFAULT_SAVE_EDIT_TIMEOUT } from '../constants';
import { isMobile } from '../utils/browser';
import { debounce } from '../utils/common';
import type { Settings } from '../types';
import { fetchUserSettings, saveUserSettings } from '../api/settings';
import { TagImportSetting } from '../types';
import { useUiStore } from './ui.store';

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings | undefined>(undefined);
  const settingsInitializing = ref(false);

  const powerUser = ref<Settings['power_user']>({
    world_import_dialog: true,
    send_on_enter: SendOnEnterOptions.AUTO,
    never_resize_avatars: false,
    external_media_forbidden_overrides: [],
    external_media_allowed_overrides: [],
    forbid_external_media: false,
    spoiler_free_mode: false,
    auto_fix_generated_markdown: false,
    tag_import_setting: TagImportSetting.ASK,
  });

  const shouldSendOnEnter = computed(() => {
    switch (powerUser.value.send_on_enter) {
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
    try {
      if (settings.value !== undefined || settingsInitializing.value) return;
      settingsInitializing.value = true;
      settings.value = await fetchUserSettings();
      powerUser.value = { ...powerUser.value, ...settings.value.power_user };
      const uiStore = useUiStore();
      uiStore.activePlayerName = settings.value.username || null;
    } finally {
      Promise.resolve().then(() => {
        settingsInitializing.value = false;
      });
    }
  }

  const saveSettingsDebounced = debounce(() => {
    if (settings.value === undefined) return;
    const uiStore = useUiStore();
    saveUserSettings({
      ...settings.value,
      power_user: powerUser.value,
      username: uiStore.activePlayerName || undefined,
    });
  }, DEFAULT_SAVE_EDIT_TIMEOUT);

  // Watch for changes in settings and trigger debounced save
  watch(
    powerUser,
    () => {
      if (settings.value === undefined || settingsInitializing.value) return;
      saveSettingsDebounced();
    },
    { deep: true },
  );

  return { powerUser, shouldSendOnEnter, saveSettingsDebounced, initializeSettings };
});
