import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { discoverExtensions, fetchManifest } from '../api/extensions';
import type { BuiltInExtensionModule, ExtensionManifest } from '../types';
import { loadScript, loadStyle } from '../utils/extension-loader';
import { sanitizeSelector } from '../utils/dom';
import { builtInExtensions } from '../extensions/built-in';
import { createScopedApiProxy } from '../utils/extension-api';
import { useSettingsStore } from './settings.store';

export interface Extension {
  id: string;
  type: string;
  manifest: ExtensionManifest;
  isActive: boolean;
  containerId: string;
  moduleRef?: BuiltInExtensionModule;
}

/**
 * Generates a consistent DOM ID for an extension container.
 */
export function getExtensionContainerId(extensionId: string): string {
  return `extension-root-${sanitizeSelector(extensionId)}`;
}

export const useExtensionStore = defineStore('extension', () => {
  const settingsStore = useSettingsStore();
  const extensions = ref<Record<string, Extension>>({});
  const searchTerm = ref('');
  const selectedExtensionId = ref<string | null>(null);
  const cleanupFunctions = new Map<string, () => void>();

  const disabledExtensions = computed(() => settingsStore.settings.disabledExtensions);

  const filteredExtensions = computed(() => {
    const lowerSearch = searchTerm.value.toLowerCase();
    return Object.values(extensions.value)
      .filter((ext) => {
        if (!lowerSearch) return true;
        return (
          ext.id.toLowerCase().includes(lowerSearch) ||
          ext.manifest.display_name?.toLowerCase().includes(lowerSearch) ||
          ext.manifest.author?.toLowerCase().includes(lowerSearch)
        );
      })
      .sort((a, b) => (a.manifest.display_name ?? a.id).localeCompare(b.manifest.display_name ?? b.id));
  });

  const selectedExtension = computed<Extension | null>(() => {
    return selectedExtensionId.value ? extensions.value[selectedExtensionId.value] : null;
  });

  function selectExtension(id: string | null) {
    selectedExtensionId.value = id;
  }

  async function initializeExtensions() {
    if (Object.keys(extensions.value).length > 0) return; // Already initialized

    if (settingsStore.settingsInitializing) {
      await new Promise<void>((resolve) => {
        const stop = watch(
          () => settingsStore.settingsInitializing,
          (initializing) => {
            if (!initializing) {
              stop();
              resolve();
            }
          },
          { immediate: true },
        );
        settingsStore.initializeSettings();
      });
    }

    // 1. Load Built-ins
    for (const module of builtInExtensions) {
      const id = module.manifest.name;
      extensions.value[id] = {
        id,
        type: 'builtin',
        manifest: module.manifest,
        isActive: false,
        containerId: getExtensionContainerId(id),
        moduleRef: module,
      };
    }

    try {
      // 2. Load External
      const discovered = await discoverExtensions();
      const manifestPromises = discovered.map(async (ext) => {
        try {
          const manifest = await fetchManifest(ext.name);
          return { ...ext, manifest };
        } catch (error) {
          console.error(`Failed to load manifest for ${ext.name}`, error);
          return null;
        }
      });

      const results = (await Promise.all(manifestPromises)).filter((x): x is NonNullable<typeof x> => x !== null);

      for (const ext of results) {
        // The name in the manifest (or folder name) is the ID
        const id = ext.name;
        // Don't overwrite built-ins if name conflict occurs (built-ins take priority/are loaded first)
        if (!extensions.value[id]) {
          extensions.value[id] = {
            id: id,
            type: ext.type,
            manifest: ext.manifest,
            isActive: false,
            containerId: getExtensionContainerId(id),
          };
        }
      }

      await activateExtensions();
    } catch (error) {
      console.error('Failed to initialize extensions:', error);
      // Even if external fails, we should try to activate built-ins
      await activateExtensions();
    }
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

      const api = createScopedApiProxy(id);

      try {
        if (ext.type === 'builtin' && ext.moduleRef) {
          // Built-in activation
          const cleanup = await ext.moduleRef.activate(api);
          if (typeof cleanup === 'function') {
            cleanupFunctions.set(id, cleanup);
          }
          console.debug(`Activated built-in extension: ${id}`);
        } else {
          // External activation
          if (ext.manifest.css) {
            await loadStyle(id, ext.manifest.css);
          }
          if (ext.manifest.js) {
            await loadScript(id, ext.manifest.js);
          }
          console.debug(`Activated external extension: ${id}`);
        }
        ext.isActive = true;

        if (save && settingsStore.settings.disabledExtensions.includes(id)) {
          settingsStore.settings.disabledExtensions = settingsStore.settings.disabledExtensions.filter((x) => x !== id);
          settingsStore.saveSettingsDebounced();
        }
      } catch (error) {
        console.error(`Failed to activate extension ${id}:`, error);
      }
    } else {
      // --- DEACTIVATION ---
      if (!ext.isActive) return;

      // 1. Run cleanup
      const cleanup = cleanupFunctions.get(id);
      if (cleanup) {
        try {
          cleanup();
        } catch (e) {
          console.error(`Error during cleanup of ${id}`, e);
        }
        cleanupFunctions.delete(id);
      }

      // 2. Update state
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
    getExtensionContainerId,
    toggleExtension,
  };
});
