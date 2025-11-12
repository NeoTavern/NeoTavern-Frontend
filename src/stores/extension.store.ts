import { defineStore } from 'pinia';
import { ref } from 'vue';
import { discoverExtensions, fetchManifest } from '../api/extensions';
import type { ExtensionManifest } from '../types';
import { loadScript, loadStyle } from '../utils/extension-loader';

interface Extension {
  name: string;
  type: string;
  manifest: ExtensionManifest;
  isActive: boolean;
}

export const useExtensionStore = defineStore('extension', () => {
  const extensions = ref<Record<string, Extension>>({});
  const disabledExtensions = ref<string[]>([]); // This should be loaded from settings store

  async function initializeExtensions() {
    try {
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

      const newExtensions: Record<string, Extension> = {};
      for (const ext of results) {
        newExtensions[ext.name] = {
          name: ext.name,
          type: ext.type,
          manifest: ext.manifest,
          isActive: false, // will be set by activation logic
        };
      }
      extensions.value = newExtensions;

      await activateExtensions();
    } catch (error) {
      console.error('Failed to initialize extensions:', error);
    }
  }

  async function activateExtensions() {
    // Basic activation logic. A full implementation would check dependencies, versions etc.
    for (const ext of Object.values(extensions.value)) {
      if (!disabledExtensions.value.includes(ext.name)) {
        try {
          if (ext.manifest.css) {
            await loadStyle(ext.name, ext.manifest.css);
          }
          if (ext.manifest.js) {
            await loadScript(ext.name, ext.manifest.js);
          }
          ext.isActive = true;
          console.debug(`Activated extension: ${ext.name}`);
        } catch (error) {
          console.error(`Failed to activate extension ${ext.name}:`, error);
        }
      }
    }
  }

  return { extensions, disabledExtensions, initializeExtensions };
});
