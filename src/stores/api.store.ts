import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { fetchChatCompletionStatus } from '../api/connection';
import {
  deleteExperimentalPreset as apideleteExperimentalPreset,
  deleteInstructTemplate as apiDeleteInstructTemplate,
  saveInstructTemplate as apiSaveInstructTemplate,
  fetchAllExperimentalPresets,
  fetchAllInstructTemplates,
  saveExperimentalPreset,
  type Preset,
} from '../api/presets';
import { PROVIDER_CAPABILITIES } from '../api/provider-definitions';
import { useStrictI18n } from '../composables/useStrictI18n';
import { toast } from '../composables/useToast';
import { defaultPrompts } from '../constants';
import type { ApiModel, ConnectionProfile, SamplerSettings } from '../types';
import { api_providers, POPUP_RESULT, POPUP_TYPE } from '../types';
import type { InstructTemplate } from '../types/instruct';
import { downloadFile, readFileAsText, uuidv4 } from '../utils/commons';
import { usePopupStore } from './popup.store';
import { useSettingsStore } from './settings.store';

export const useApiStore = defineStore('api', () => {
  const { t } = useStrictI18n();
  const settingsStore = useSettingsStore();
  const popupStore = usePopupStore();

  const onlineStatus = ref(t('api.status.notConnected'));
  const isConnecting = ref(false);
  const modelList = ref<ApiModel[]>([]);
  const presets = ref<Preset[]>([]);

  const instructTemplates = ref<InstructTemplate[]>([]);

  // --- Connection Profiles ---
  const connectionProfiles = computed({
    get: () => settingsStore.settings.api.connectionProfiles,
    set: (value) => (settingsStore.settings.api.connectionProfiles = value),
  });

  const selectedConnectionProfileName = computed({
    get: () => settingsStore.settings.api.selectedConnectionProfile,
    set: (value) => (settingsStore.settings.api.selectedConnectionProfile = value),
  });

  const activeModel = computed(() => {
    const apiSettings = settingsStore.settings.api;
    return apiSettings.selectedProviderModels[apiSettings.provider];
  });

  const groupedOpenRouterModels = computed<Record<string, ApiModel[]> | null>(() => {
    if (settingsStore.settings.api.provider !== api_providers.OPENROUTER || modelList.value.length === 0) {
      return null;
    }
    // TODO: implement sorting from settings
    const sortedList = [...modelList.value].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

    // Group by vendor
    const vendors = sortedList.reduce(
      (acc, model) => {
        const vendor = model.id.split('/')[0];
        if (!acc[vendor]) {
          acc[vendor] = [];
        }
        acc[vendor].push(model);
        return acc;
      },
      {} as Record<string, ApiModel[]>,
    );

    return vendors;
  });

  async function initialize() {
    await settingsStore.waitForSettings();

    // Auto-connect on start
    await connect();
  }

  // When the user selects a different connection profile, apply its settings as a one-time action.
  watch(selectedConnectionProfileName, (profileName) => {
    if (settingsStore.settingsInitializing) return;

    const profile = connectionProfiles.value.find((p) => p.name === profileName);
    if (profile) {
      // Apply profile settings to the main settings state, only overriding defined fields.
      if (profile.provider) settingsStore.settings.api.provider = profile.provider;
      if (profile.sampler) settingsStore.settings.api.selectedSampler = profile.sampler;
      if (profile.model) {
        const provider = profile.provider ?? settingsStore.settings.api.provider;
        settingsStore.settings.api.selectedProviderModels[provider] = profile.model;
      }
      if (profile.formatter) {
        settingsStore.settings.api.formatter = profile.formatter;
      }
      if (profile.instructTemplate) {
        settingsStore.settings.api.instructTemplateName = profile.instructTemplate;
      }

      const caps = PROVIDER_CAPABILITIES[settingsStore.settings.api.provider];
      if (caps) {
        if (!caps.supportsText && settingsStore.settings.api.formatter === 'text') {
          settingsStore.settings.api.formatter = 'chat';
        } else if (!caps.supportsChat && settingsStore.settings.api.formatter === 'chat') {
          settingsStore.settings.api.formatter = 'text';
        }
      }

      // After applying, reconnect to validate the new settings.
      connect();
    }
  });

  // When the main API or provider changes manually, try to reconnect
  watch(
    () => [settingsStore.settings.api.provider],
    ([newProvider], [oldProvider]) => {
      if (settingsStore.settingsInitializing) return;
      // Only connect if the actual values have changed
      if (newProvider !== oldProvider) {
        const caps = PROVIDER_CAPABILITIES[newProvider];
        if (caps) {
          if (!caps.supportsText && settingsStore.settings.api.formatter === 'text') {
            settingsStore.settings.api.formatter = 'chat';
          } else if (!caps.supportsChat && settingsStore.settings.api.formatter === 'chat') {
            settingsStore.settings.api.formatter = 'text';
          }
        }

        connect();
      }
    },
  );

  // When the user selects a different preset, apply its settings
  watch(
    () => settingsStore.settings.api.selectedSampler,
    (newPresetName) => {
      if (settingsStore.settingsInitializing || !newPresetName) return;

      const preset = presets.value.find((p) => p.name === newPresetName);
      if (preset) {
        settingsStore.settings.api.samplers = { ...preset.preset };
      }
    },
  );

  async function connect() {
    if (isConnecting.value) return;

    modelList.value = [];
    const apiSettings = settingsStore.settings.api;

    isConnecting.value = true;
    onlineStatus.value = t('api.status.connecting');

    try {
      // TODO: Implement secret management. For now, we pass the key directly.
      // TODO: Implement reverse proxy confirmation popup.
      const response = await fetchChatCompletionStatus({
        chat_completion_source: apiSettings.provider,
        reverse_proxy: apiSettings.reverseProxy,
        proxy_password: apiSettings.proxyPassword,
      });

      if (response.error) {
        throw new Error(response.error);
      }

      if (response.data && Array.isArray(response.data)) {
        modelList.value = response.data;

        // Check if current model selection is still valid
        const provider = apiSettings.provider;
        const availableModels = modelList.value.map((m) => m.id);

        // TODO: Add dynamic models for other providers
        if (provider === api_providers.OPENAI) {
          const openaiModel = apiSettings.selectedProviderModels.openai;
          if (!availableModels.includes(openaiModel ?? '')) {
            apiSettings.selectedProviderModels.openai = availableModels.length > 0 ? availableModels[0] : 'gpt-4o';
          }
        } else if (provider === api_providers.OPENROUTER) {
          if (
            apiSettings.selectedProviderModels.openrouter !== 'OR_Website' &&
            !availableModels.includes(apiSettings.selectedProviderModels.openrouter ?? '')
          ) {
            apiSettings.selectedProviderModels.openrouter =
              availableModels.length > 0 ? availableModels[0] : 'OR_Website';
          }
        }
      }

      onlineStatus.value = response.bypass ? t('api.status.bypassed') : t('api.status.valid');
      toast.success(t('api.connectSuccess'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      onlineStatus.value = t('api.status.noConnection');
      toast.error(error.message || t('api.connectFailed'));
      console.error(error);
    } finally {
      isConnecting.value = false;
    }
  }

  async function loadPresetsForApi() {
    try {
      presets.value = await fetchAllExperimentalPresets();
    } catch (error) {
      console.error('Failed to load presets:', error);
      toast.error('Could not load presets.');
    }
  }

  async function saveCurrentPresetAs(name: string) {
    try {
      // Create a clean preset object from current samplers
      const presetData: SamplerSettings = { ...settingsStore.settings.api.samplers };

      await saveExperimentalPreset(name, presetData);
      await loadPresetsForApi();
      settingsStore.settings.api.selectedSampler = name;
    } catch (error: unknown) {
      toast.error(`Failed to save preset "${name}".`);
      console.error('Failed to save preset:', error);
    }
  }

  function updateCurrentPreset(name?: string) {
    if (!name) {
      toast.warning(t('aiConfig.presets.errors.noPresetName'));
      return;
    }
    saveCurrentPresetAs(name);
  }

  async function renamePreset(oldName?: string) {
    if (!oldName) {
      toast.warning(t('aiConfig.presets.errors.renameDefault'));
      return;
    }
    const { result, value: newName } = await popupStore.show<string>({
      title: t('aiConfig.presets.renamePopupTitle'),
      type: POPUP_TYPE.INPUT,
      inputValue: oldName,
    });

    if (result === POPUP_RESULT.AFFIRMATIVE && newName && newName.trim() && newName !== oldName) {
      try {
        const presetToRename = presets.value.find((p) => p.name === oldName);
        if (!presetToRename) throw new Error('Preset not found');

        // Rename is a delete and save operation
        await apideleteExperimentalPreset(oldName);
        await saveExperimentalPreset(newName, presetToRename.preset);

        await loadPresetsForApi();
        settingsStore.settings.api.selectedSampler = newName;
      } catch (error) {
        toast.error('Failed to rename preset.');
        console.error(error);
      }
    }
  }

  async function deleteExperimentalPreset(name?: string) {
    if (!name) {
      toast.warning(t('aiConfig.presets.errors.deleteDefault'));
      return;
    }
    const { result } = await popupStore.show({
      title: t('common.confirmDelete'),
      content: t('aiConfig.presets.deletePopupContent', { name }),
      type: POPUP_TYPE.CONFIRM,
    });

    if (result === POPUP_RESULT.AFFIRMATIVE) {
      try {
        await apideleteExperimentalPreset(name);
        if (settingsStore.settings.api.selectedSampler === name) {
          settingsStore.settings.api.selectedSampler = 'Default';
        }
        await loadPresetsForApi();
      } catch (error: unknown) {
        toast.error(`Failed to delete preset "${name}".`);
        console.error('Failed to delete preset:', error);
      }
    }
  }

  function importPreset() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const content = await readFileAsText(file);
        const presetData = JSON.parse(content);
        const name = file.name.replace(/\.json$/, '');
        // TODO: Add confirmation for overwriting existing preset, like original ST
        await saveExperimentalPreset(name, presetData);
        await loadPresetsForApi();
        settingsStore.settings.api.selectedSampler = name;
      } catch (error) {
        toast.error(t('aiConfig.presets.errors.importInvalid'));
        console.error(error);
      }
    };
    input.click();
  }

  function exportPreset(name?: string) {
    if (!name) {
      toast.error(t('aiConfig.presets.errors.noExportSelected'));
      return;
    }
    const presetToExport = presets.value.find((p) => p.name === name);
    if (!presetToExport) {
      toast.error(t('aiConfig.presets.errors.exportNotFound', { name }));
      return;
    }

    const content = JSON.stringify(presetToExport.preset, null, 2);
    downloadFile(content, `${name}.json`, 'application/json');
  }

  // --- Connection Profile Management ---
  async function createConnectionProfile(profileData: Omit<ConnectionProfile, 'id'>) {
    if (connectionProfiles.value.some((p) => p.name === profileData.name)) {
      toast.error(t('apiConnections.profileManagement.errors.nameExists'));
      return;
    }

    const newProfile: ConnectionProfile = {
      ...profileData,
      id: uuidv4(),
    };
    connectionProfiles.value = [...connectionProfiles.value, newProfile];
    selectedConnectionProfileName.value = newProfile.name;
  }

  async function renameConnectionProfile() {
    const oldName = selectedConnectionProfileName.value;
    if (!oldName) {
      toast.warning(t('apiConnections.profileManagement.errors.renameNone'));
      return;
    }

    const { result, value: newName } = await popupStore.show<string>({
      title: t('apiConnections.profileManagement.renamePopupTitle'),
      type: POPUP_TYPE.INPUT,
      inputValue: oldName,
    });

    if (result === POPUP_RESULT.AFFIRMATIVE && newName && newName.trim() && newName !== oldName) {
      const profile = connectionProfiles.value.find((p) => p.name === oldName);
      if (profile) {
        profile.name = newName;
        connectionProfiles.value = [...connectionProfiles.value]; // Trigger reactivity
        selectedConnectionProfileName.value = newName;
      }
    }
  }

  async function deleteConnectionProfile() {
    const name = selectedConnectionProfileName.value;
    if (!name) {
      toast.warning(t('apiConnections.profileManagement.errors.deleteNone'));
      return;
    }

    const { result } = await popupStore.show({
      title: t('common.confirmDelete'),
      content: t('apiConnections.profileManagement.deletePopupContent', { name }),
      type: POPUP_TYPE.CONFIRM,
    });

    if (result === POPUP_RESULT.AFFIRMATIVE) {
      connectionProfiles.value = connectionProfiles.value.filter((p) => p.name !== name);
      selectedConnectionProfileName.value = undefined;
    }
  }

  function importConnectionProfiles() {
    // TODO: Implement import logic
    toast.info('Importing profiles is not yet implemented.');
  }

  function exportConnectionProfile() {
    const name = selectedConnectionProfileName.value;
    if (!name) {
      toast.error(t('apiConnections.profileManagement.errors.noSelection'));
      return;
    }
    const profile = connectionProfiles.value.find((p) => p.name === name);
    if (profile) {
      const content = JSON.stringify([profile], null, 2);
      downloadFile(content, `${name}-profile.json`, 'application/json');
    }
  }

  // --- Prompt Management ---

  function updatePromptContent(identifier: string, content: string) {
    const prompt = settingsStore.settings.api.samplers.prompts?.find((p) => p.identifier === identifier);
    if (prompt) {
      prompt.content = content;
    }
  }

  function resetPrompts() {
    settingsStore.settings.api.samplers.prompts = structuredClone(defaultPrompts);
  }

  async function loadInstructTemplates() {
    try {
      const fetchedTemplates = await fetchAllInstructTemplates();
      instructTemplates.value = fetchedTemplates;
    } catch (e) {
      console.warn('Failed to load instruct templates, using default', e);
      instructTemplates.value = [];
    }
  }

  async function saveInstructTemplate(template: InstructTemplate) {
    try {
      await apiSaveInstructTemplate(template);
      await loadInstructTemplates();
      settingsStore.settings.api.instructTemplateName = template.name;
    } catch (e) {
      toast.error('Error saving instruct template');
      console.error(e);
    }
  }

  async function deleteInstructTemplate(name: string) {
    try {
      await apiDeleteInstructTemplate(name);
      await loadInstructTemplates();
      if (settingsStore.settings.api.instructTemplateName === name) {
        settingsStore.settings.api.instructTemplateName = 'ChatML';
      }
    } catch {
      toast.error('Error deleting instruct template');
    }
  }

  function importInstructTemplate() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const content = await readFileAsText(file);
        const data = JSON.parse(content);
        await saveInstructTemplate(data);
        toast.success('Template imported');
      } catch {
        toast.error('Invalid template file');
      }
    };
    input.click();
  }

  function exportInstructTemplate(name: string) {
    const tpl = instructTemplates.value.find((t) => t.name === name);
    if (tpl) {
      downloadFile(JSON.stringify(tpl, null, 2), `${name}.json`, 'application/json');
    }
  }

  return {
    initialize,
    onlineStatus,
    isConnecting,
    connect,
    activeModel,
    modelList,
    groupedOpenRouterModels,
    presets,
    loadPresetsForApi,
    saveCurrentPresetAs,
    updateCurrentPreset,
    renamePreset,
    deleteExperimentalPreset,
    importPreset,
    exportPreset,
    updatePromptContent,
    resetPrompts,
    // Connection Profiles
    connectionProfiles,
    selectedConnectionProfileName,
    createConnectionProfile,
    renameConnectionProfile,
    deleteConnectionProfile,
    importConnectionProfiles,
    exportConnectionProfile,
    // Instruct
    instructTemplates,
    loadInstructTemplates,
    saveInstructTemplate,
    deleteInstructTemplate,
    importInstructTemplate,
    exportInstructTemplate,
  };
});
