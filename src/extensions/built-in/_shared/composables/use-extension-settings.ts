import { onMounted, ref, watch, type Ref } from 'vue';

interface UseExtensionSettingsOptions<TSettings> {
  onLoaded?: (settings: TSettings) => void;
  onBeforeSave?: (settings: TSettings) => void;
}

interface ExtensionSettingsAPI<TSettings> {
  settings: {
    get: () => TSettings;
    set: (path: undefined, value: TSettings) => void;
    save: () => void;
  };
}

export function useExtensionSettings<TSettings>(
  api: ExtensionSettingsAPI<TSettings>,
  initialSettings: TSettings,
  migrateSettings: (settings: TSettings) => TSettings,
  options: UseExtensionSettingsOptions<TSettings> = {},
): Ref<TSettings> {
  const settings = ref(initialSettings) as Ref<TSettings>;

  onMounted(() => {
    settings.value = migrateSettings(api.settings.get());
    options.onLoaded?.(settings.value);
  });

  watch(
    settings,
    (value) => {
      api.settings.set(undefined, value);
      options.onBeforeSave?.(value);
      api.settings.save();
    },
    { deep: true },
  );

  return settings;
}
