import { defineStore } from 'pinia';
import { computed, nextTick, ref } from 'vue';
import { useStrictI18n } from '../composables/useStrictI18n';
import { builtInExtensions } from '../extensions/built-in';
import type { BuiltInExtensionModule, ExtensionManifest } from '../types';
import { createExtensionApi, disposeExtension } from '../utils/extensions';
import { useSettingsStore } from './settings.store';

export interface Extension {
  id: string;
  manifest: ExtensionManifest;
  isActive: boolean;
  module: BuiltInExtensionModule;
}

export const useExtensionStore = defineStore('extension', () => {
  const settingsStore = useSettingsStore();
  const { t } = useStrictI18n();
  const extensions = ref<Record<string, Extension>>({});
  const searchTerm = ref('');
  const selectedExtensionId = ref<string | null>(null);
  const cleanupFunctions = new Map<string, () => void>();

  const disabledExtensions = computed(() => settingsStore.settings.disabledExtensions);

  function getExtensionDisplayName(extension: Extension): string {
    return t(extension.manifest.display_name);
  }

  function getExtensionDescription(extension: Extension): string {
    return t(extension.manifest.description);
  }

  const filteredExtensions = computed(() => {
    const lowerSearch = searchTerm.value.toLowerCase();
    return Object.values(extensions.value)
      .filter((ext) => {
        if (!lowerSearch) return true;
        return (
          ext.id.toLowerCase().includes(lowerSearch) ||
          getExtensionDisplayName(ext).toLowerCase().includes(lowerSearch) ||
          ext.manifest.author?.toLowerCase().includes(lowerSearch)
        );
      })
      .sort((a, b) => getExtensionDisplayName(a).localeCompare(getExtensionDisplayName(b)));
  });

  const selectedExtension = computed<Extension | null>(() => {
    return selectedExtensionId.value ? extensions.value[selectedExtensionId.value] : null;
  });

  function selectExtension(id: string | null) {
    selectedExtensionId.value = id;
  }

  async function initializeExtensions() {
    if (Object.keys(extensions.value).length > 0) return; // Already initialized

    for (const module of builtInExtensions) {
      const id = module.manifest.name;
      extensions.value[id] = {
        id,
        manifest: module.manifest,
        isActive: false,
        module,
      };
    }

    await nextTick();
    await activateExtensions();
  }

  async function activateExtensions() {
    for (const ext of Object.values(extensions.value)) {
      if (!disabledExtensions.value.includes(ext.id) && !ext.isActive) {
        // Activate without modifying settings (save=false)
        await toggleExtension(ext.id, true, false);
      }
    }
  }

  async function toggleExtension(id: string, enabled: boolean, save = true) {
    const ext = extensions.value[id];
    if (!ext) return;

    if (enabled) {
      // --- ACTIVATION ---
      if (ext.isActive) return;

      const api = createExtensionApi(id);

      try {
        if (ext.module.migrateSettings) {
          api.settings.set(undefined, ext.module.migrateSettings(api.settings.get()));
        }
        const cleanup = await ext.module.activate(api);
        if (typeof cleanup === 'function') {
          cleanupFunctions.set(id, cleanup);
        }
        console.debug(`Activated extension: ${id}`);
        ext.isActive = true;

        if (save && settingsStore.settings.disabledExtensions.includes(id)) {
          settingsStore.settings.disabledExtensions = settingsStore.settings.disabledExtensions.filter((x) => x !== id);
          settingsStore.saveSettingsDebounced();
        }
      } catch (error) {
        console.error(`Failed to activate extension ${id}:`, error);
        disposeExtension(id);
      }
    } else {
      // --- DEACTIVATION ---
      if (!ext.isActive) return;

      // 1. Run the extension's own cleanup
      const cleanup = cleanupFunctions.get(id);
      if (cleanup) {
        try {
          cleanup();
        } catch (e) {
          console.error(`Error during cleanup of ${id}`, e);
        }
        cleanupFunctions.delete(id);
      }

      // 2. Dispose of everything registered through its API (listeners, UI, tools, services)
      disposeExtension(id);

      // 3. Update state
      ext.isActive = false;
      if (save && !settingsStore.settings.disabledExtensions.includes(id)) {
        settingsStore.settings.disabledExtensions.push(id);
        settingsStore.saveSettingsDebounced();
      }
      console.debug(`Deactivated extension: ${id}`);
    }
  }

  return {
    extensions,
    disabledExtensions,
    searchTerm,
    selectedExtensionId,
    filteredExtensions,
    selectedExtension,
    selectExtension,
    initializeExtensions,
    getExtensionDisplayName,
    getExtensionDescription,
    toggleExtension,
  };
});
