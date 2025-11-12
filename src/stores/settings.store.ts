import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { SendOnEnterOptions } from '../constants';
import { isMobile } from '../utils/browser';

export const useSettingsStore = defineStore('settings', () => {
  const powerUser = ref<{
    external_media_forbidden_overrides: Array<string>;
    external_media_allowed_overrides: Array<string>;
    forbid_external_media: boolean;
    world_import_dialog: boolean;
    send_on_enter: number;
    never_resize_avatars: boolean;
    spoiler_free_mode: boolean;
  }>({
    world_import_dialog: true,
    send_on_enter: SendOnEnterOptions.AUTO,
    never_resize_avatars: false,
    external_media_forbidden_overrides: [],
    external_media_allowed_overrides: [],
    forbid_external_media: false,
    spoiler_free_mode: false,
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

  return { powerUser, shouldSendOnEnter };
});
