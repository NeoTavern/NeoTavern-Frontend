import { GenerationMode } from '../../../constants';
import type { ExtensionAPI } from '../../../types';
import type { GenerationPayloadBuilderConfig } from '../../../types/events';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { DEFAULT_SETTINGS, type RandomizerSettings } from './types';
import { getRandomInRange, selectRandomConnectionProfile, selectRandomModelFromGroups, validateProfile } from './utils';

export { manifest };

export function activate(api: ExtensionAPI<RandomizerSettings>) {
  const getSettings = (): RandomizerSettings => {
    const saved = api.settings.get();
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      profiles: saved?.profiles ?? [],
    };
  };

  let settingsApp: { unmount: () => void } | null = null;
  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    settingsApp = api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  const unbindPayload = api.events.on('generation:build-payload', async (config: GenerationPayloadBuilderConfig) => {
    const settings = getSettings();

    if (!settings.enabled) return;

    const allowedModes = [GenerationMode.NEW, GenerationMode.REGENERATE, GenerationMode.ADD_SWIPE];
    if (!allowedModes.includes(config.mode)) {
      return;
    }

    const activeProfile = settings.profiles.find((p) => p.id === settings.activeProfileId);
    if (!activeProfile) return;

    const connectionProfiles = api.api.getConnectionProfiles();
    const validation = validateProfile(activeProfile, connectionProfiles);

    if (!validation.valid) {
      console.warn(`[Model Randomizer] Active profile validation failed: ${validation.error}`);
      return;
    }

    try {
      if (activeProfile.type === 'connection-profiles' && activeProfile.connectionProfileIds) {
        // We need to use `resolveConnectionProfileSettings` via ExtensionAPI
        const selectedProfile = selectRandomConnectionProfile(activeProfile.connectionProfileIds, connectionProfiles);

        if (!selectedProfile) return;

        if (selectedProfile.provider) {
          config.provider = selectedProfile.provider;
        }
        if (selectedProfile.model) {
          config.model = selectedProfile.model;
        }
        if (selectedProfile.formatter) {
          config.formatter = selectedProfile.formatter;
        }
        if (selectedProfile.instructTemplate) {
          // TODO: ExtensionAPI should support fetching templates by name/id instead
        }
        if (selectedProfile.reasoningTemplate) {
          // TODO: ExtensionAPI should support fetching templates by name/id instead
        }
        if (selectedProfile.customPromptPostProcessing !== undefined) {
          config.customPromptPostProcessing = selectedProfile.customPromptPostProcessing;
        }
        if (selectedProfile.apiUrl && selectedProfile.provider) {
          if (selectedProfile?.apiUrl !== undefined) {
            if (selectedProfile.provider === 'custom') {
              config.providerSpecific.custom.url = selectedProfile.apiUrl;
            } else if (selectedProfile.provider === 'koboldcpp') {
              config.providerSpecific.koboldcpp.url = selectedProfile.apiUrl;
            } else if (selectedProfile.provider === 'ollama') {
              config.providerSpecific.ollama.url = selectedProfile.apiUrl;
            }
          }
        }
      } else if (activeProfile.type === 'model-groups' && activeProfile.modelGroups) {
        const selection = selectRandomModelFromGroups(activeProfile.modelGroups);

        if (!selection) return;

        config.provider = selection.group.provider;
        config.model = selection.model.id;

        if (selection.group.temperatureRange) {
          const randomTemp = getRandomInRange(
            selection.group.temperatureRange.min,
            selection.group.temperatureRange.max,
          );
          config.samplerSettings = {
            ...config.samplerSettings,
            temperature: randomTemp,
          };
        }
      }
    } catch (error) {
      console.error('[Model Randomizer] Error during randomization:', error);
    }
  });

  return () => {
    unbindPayload();
    if (settingsApp) {
      settingsApp.unmount();
    }
  };
}
