import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { fetchChatCompletionStatus, fetchTextCompletionStatus } from '../api/connection';
import {
  deleteInstructTemplate as apiDeleteInstructTemplate,
  deleteReasoningTemplate as apiDeleteReasoningTemplate,
  deleteSamplerPreset as apideleteSamplerPreset,
  saveInstructTemplate as apiSaveInstructTemplate,
  saveReasoningTemplate as apiSaveReasoningTemplate,
  fetchAllInstructTemplates,
  fetchAllReasoningTemplates,
  fetchAllSamplerPresets,
  saveSamplerPreset,
  type Preset,
} from '../api/presets';
import { PROVIDER_CAPABILITIES } from '../api/provider-definitions';
import { useStrictI18n } from '../composables/useStrictI18n';
import { toast } from '../composables/useToast';
import { defaultPrompts, PROVIDER_SECRET_KEYS } from '../constants';
import { migrateLegacyOaiPreset } from '../services/settings-migration.service';
import type {
  ApiModel,
  ApiProvider,
  ConnectionProfile,
  LegacyOaiPresetSettings,
  ReasoningTemplate,
  SamplerSettings,
} from '../types';
import { api_providers, POPUP_RESULT, POPUP_TYPE } from '../types';
import type { InstructTemplate } from '../types/instruct';
import { downloadFile, readFileAsText, uuidv4 } from '../utils/commons';
import { usePopupStore } from './popup.store';
import { useSecretStore } from './secret.store';
import { useSettingsStore } from './settings.store';

export const useApiStore = defineStore('api', () => {
  const { t } = useStrictI18n();
  const settingsStore = useSettingsStore();
  const popupStore = usePopupStore();
  const secretStore = useSecretStore();

  const onlineStatus = ref(t('api.status.notConnected'));
  const isConnecting = ref(false);
  const modelList = ref<ApiModel[]>([]);
  const presets = ref<Preset<SamplerSettings>[]>([]);

  const instructTemplates = ref<InstructTemplate[]>([]);
  const reasoningTemplates = ref<ReasoningTemplate[]>([]);

  const watchersInitialized = ref(false);

  const connectionProfiles = computed({
    get: () => settingsStore.settings.api.connectionProfiles,
    set: (value) => (settingsStore.settings.api.connectionProfiles = value),
  });

  const selectedConnectionProfile = computed({
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
    const sortedList = [...modelList.value].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

    return sortedList.reduce(
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
  });

  async function initialize() {
    // Setup watchers only after settings are ready
    setupWatchers();

    await connect();
  }

  function setupWatchers() {
    // Prevent multiple initializations
    if (watchersInitialized.value) return;
    watchersInitialized.value = true;

    // Keep watching provider changes from other sources (like UI dropdowns not using profiles)
    watch(
      () => settingsStore.settings.api.provider,
      (newProvider, oldProvider) => {
        if (newProvider !== oldProvider) {
          validateFormatterCapabilities(newProvider);
          connect();
        }
      },
    );

    // Watch for sampler changes
    watch(
      () => settingsStore.settings.api.selectedSampler,
      (newPresetName) => {
        if (!newPresetName) return;
        const preset = presets.value.find((p) => p.name === newPresetName);
        if (preset) {
          settingsStore.settings.api.samplers = { ...preset.preset };
        }
      },
    );

    // Watch Proxy changes
    watch(
      () => settingsStore.settings.api.proxy.id,
      (newId, oldId) => {
        if (newId !== oldId) {
          const proxy = settingsStore.settings.proxies?.find((p) => p.id === newId);
          if (proxy) {
            settingsStore.settings.api.proxy.url = proxy.url;
            settingsStore.settings.api.proxy.password = proxy.password;
          } else {
            settingsStore.settings.api.proxy.url = '';
            settingsStore.settings.api.proxy.password = '';
          }
          connect();
        }
      },
    );

    // Watch connection profile changes
    watch(
      () => settingsStore.settings.api.selectedConnectionProfile,
      (newProfile, oldProfile) => {
        if (newProfile !== oldProfile && newProfile) {
          selectConnectionProfile(newProfile);
        }
      },
    );
  }

  async function selectConnectionProfile(id: string) {
    settingsStore.settings.api.selectedConnectionProfile = id;

    const profile = connectionProfiles.value.find((p) => p.id === id);
    if (!profile) return;

    if (profile.provider && profile.provider !== settingsStore.settings.api.provider) {
      settingsStore.settings.api.provider = profile.provider;
    }
    if (profile.sampler && profile.sampler !== settingsStore.settings.api.selectedSampler) {
      settingsStore.settings.api.selectedSampler = profile.sampler;
    }
    if (
      profile.model &&
      profile.model !==
        settingsStore.settings.api.selectedProviderModels[profile.provider ?? settingsStore.settings.api.provider]
    ) {
      const provider = profile.provider ?? settingsStore.settings.api.provider;
      settingsStore.settings.api.selectedProviderModels[provider] = profile.model;
    }
    if (profile.formatter && settingsStore.settings.api.formatter !== profile.formatter) {
      settingsStore.settings.api.formatter = profile.formatter;
    }
    if (profile.instructTemplate && profile.instructTemplate !== settingsStore.settings.api.instructTemplateName) {
      settingsStore.settings.api.instructTemplateName = profile.instructTemplate;
    }
    if (profile.reasoningTemplate && profile.reasoningTemplate !== settingsStore.settings.api.reasoningTemplateName) {
      settingsStore.settings.api.reasoningTemplateName = profile.reasoningTemplate;
    }
    if (
      profile.customPromptPostProcessing !== undefined &&
      profile.customPromptPostProcessing !== settingsStore.settings.api.customPromptPostProcessing
    ) {
      settingsStore.settings.api.customPromptPostProcessing = profile.customPromptPostProcessing;
    }
    if (profile.apiUrl !== undefined) {
      const provider = profile.provider ?? settingsStore.settings.api.provider;
      // Set API URL based on provider type
      if (provider === api_providers.CUSTOM) {
        settingsStore.settings.api.providerSpecific.custom.url = profile.apiUrl;
      } else if (provider === api_providers.KOBOLDCPP) {
        settingsStore.settings.api.providerSpecific.koboldcpp.url = profile.apiUrl;
      } else if (provider === api_providers.OLLAMA) {
        settingsStore.settings.api.providerSpecific.ollama.url = profile.apiUrl;
      }
    }
    if (profile.secretId !== undefined) {
      // Rotate to the specified secret if it exists
      const provider = profile.provider ?? settingsStore.settings.api.provider;
      const secretKey = getSecretKeyForProvider(provider);
      if (secretKey) {
        const secret = secretStore.secrets[secretKey]?.find((s) => s.id === profile.secretId);
        if (secret && !secret.active) {
          await secretStore.rotateSecret(secretKey, profile.secretId);
        }
      }
    }

    validateFormatterCapabilities(settingsStore.settings.api.provider);
    connect();
  }

  function validateFormatterCapabilities(provider: string) {
    const caps = PROVIDER_CAPABILITIES[provider];
    if (caps) {
      if (!caps.supportsText && settingsStore.settings.api.formatter === 'text') {
        settingsStore.settings.api.formatter = 'chat';
      } else if (!caps.supportsChat && settingsStore.settings.api.formatter === 'chat') {
        settingsStore.settings.api.formatter = 'text';
      }
    }
  }

  function getSecretKeyForProvider(provider: ApiProvider): string | null {
    return PROVIDER_SECRET_KEYS[provider] ?? null;
  }

  async function processPendingSecrets() {
    const keys = Object.keys(secretStore.pendingSecrets);
    if (keys.length === 0) return;

    for (const key of keys) {
      const value = secretStore.pendingSecrets[key]?.trim();
      if (!value) continue;

      const activeSecret = secretStore.getActiveSecret(key);
      const label = activeSecret ? activeSecret.label : `Manual Entry ${new Date().toLocaleDateString()}`;

      const newId = await secretStore.createSecret(key, value, label);

      if (newId) {
        await secretStore.rotateSecret(key, newId);
        delete secretStore.pendingSecrets[key];
      }
    }
  }

  async function connect() {
    if (isConnecting.value) return;

    isConnecting.value = true;
    onlineStatus.value = t('api.status.connecting');

    try {
      await processPendingSecrets();

      const apiSettings = settingsStore.settings.api;
      let response;

      if (apiSettings.provider === api_providers.KOBOLDCPP) {
        // We could use kobold CC models endpoint too. It's just a preference.
        const baseUrl = apiSettings.providerSpecific.koboldcpp.url.replace(/\/v1(?:.*)?$/, '');
        response = await fetchTextCompletionStatus({
          api_type: 'koboldcpp',
          api_server: baseUrl,
        });
      } else if (apiSettings.provider === api_providers.OLLAMA) {
        response = await fetchChatCompletionStatus({
          chat_completion_source: 'custom',
          custom_url: apiSettings.providerSpecific.ollama.url,
        });
      } else {
        response = await fetchChatCompletionStatus({
          chat_completion_source: apiSettings.provider,
          reverse_proxy: apiSettings.proxy?.url,
          proxy_password: apiSettings.proxy?.password,
          custom_url:
            apiSettings.provider === api_providers.CUSTOM ? apiSettings.providerSpecific.custom.url : undefined,
        });
      }

      if (response.error) {
        throw new Error(response.error);
      }

      if (response.data && Array.isArray(response.data)) {
        modelList.value = response.data;
      } else {
        modelList.value = [];
      }

      if (
        (apiSettings.provider === api_providers.KOBOLDCPP || apiSettings.provider === api_providers.OLLAMA) &&
        modelList.value.length > 0
      ) {
        const currentModel = apiSettings.selectedProviderModels[apiSettings.provider];
        if (!currentModel) {
          apiSettings.selectedProviderModels[apiSettings.provider] = modelList.value[0].id;
        }
      }

      onlineStatus.value = response.bypass ? t('api.status.bypassed') : t('api.status.valid');
      toast.success(t('api.connectSuccess'));
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (error as any).message || t('api.connectFailed');
      onlineStatus.value = t('api.status.noConnection');
      toast.error(msg);
      console.error(error);
      modelList.value = [];
    } finally {
      isConnecting.value = false;
    }
  }

  async function loadPresetsForApi() {
    try {
      presets.value = await fetchAllSamplerPresets();
    } catch (error) {
      console.error('Failed to load presets:', error);
      toast.error('Could not load presets.');
    }
  }

  async function saveCurrentPresetAs(name: string) {
    try {
      const presetData: SamplerSettings = { ...settingsStore.settings.api.samplers };
      await saveSamplerPreset(name, presetData);
      const existingIndex = presets.value.findIndex((p) => p.name === name);
      if (existingIndex >= 0) {
        presets.value[existingIndex] = { name, preset: presetData };
      }
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

        await apideleteSamplerPreset(oldName);
        await saveSamplerPreset(newName, presetToRename.preset);

        presets.value = presets.value.filter((p) => p.name !== oldName);
        presets.value.push({ name: newName, preset: presetToRename.preset });
        settingsStore.settings.api.selectedSampler = newName;
      } catch (error) {
        toast.error('Failed to rename preset.');
        console.error(error);
      }
    }
  }

  async function deleteSamplerPreset(name?: string) {
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
        await apideleteSamplerPreset(name);
        if (settingsStore.settings.api.selectedSampler === name) {
          settingsStore.settings.api.selectedSampler = 'Default';
        }
        presets.value = presets.value.filter((p) => p.name !== name);
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
        let presetData = JSON.parse(content);
        const name = file.name.replace(/\.json$/, '');

        if ('openai_max_context' in presetData || 'prompt_order' in presetData) {
          try {
            presetData = migrateLegacyOaiPreset(presetData as LegacyOaiPresetSettings);
            toast.success(t('aiConfig.presets.messages.migrateSuccess'));
          } catch (error) {
            console.error('Migration failed:', error);
            toast.error(t('aiConfig.presets.errors.migrateFailed'));
            return;
          }
        }

        // TODO: Add confirmation for overwriting existing preset, like original ST
        await saveSamplerPreset(name, presetData);
        const existingIndex = presets.value.findIndex((p) => p.name === name);
        if (existingIndex >= 0) {
          presets.value[existingIndex] = { name, preset: presetData };
        } else {
          presets.value.push({ name, preset: presetData });
        }
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
    selectConnectionProfile(newProfile.id);
  }

  async function updateConnectionProfile() {
    const name = selectedConnectionProfile.value;
    if (!name) {
      toast.error(t('apiConnections.profileManagement.errors.noSelection'));
      return;
    }

    const profileIndex = connectionProfiles.value.findIndex((p) => p.name === name);
    if (profileIndex === -1) {
      toast.error(t('apiConnections.profileManagement.errors.notFound'));
      return;
    }

    const profile = connectionProfiles.value[profileIndex];
    // Create a copy to update
    const updatedProfile: ConnectionProfile = { ...profile };

    // Update only fields that exist in the profile
    const currentProvider = settingsStore.settings.api.provider;

    if (updatedProfile.provider) {
      updatedProfile.provider = currentProvider;
    }

    if (updatedProfile.model !== undefined) {
      // Model depends on provider, but since we are updating with current settings,
      // we take the model that is currently selected for the current provider
      updatedProfile.model = settingsStore.settings.api.selectedProviderModels[currentProvider];
    }

    if (updatedProfile.sampler) {
      updatedProfile.sampler = settingsStore.settings.api.selectedSampler;
    }

    if (updatedProfile.formatter) {
      updatedProfile.formatter = settingsStore.settings.api.formatter;
    }

    if (updatedProfile.customPromptPostProcessing !== undefined) {
      updatedProfile.customPromptPostProcessing = settingsStore.settings.api.customPromptPostProcessing;
    }

    if (updatedProfile.instructTemplate) {
      updatedProfile.instructTemplate = settingsStore.settings.api.instructTemplateName;
    }

    if (updatedProfile.reasoningTemplate) {
      updatedProfile.reasoningTemplate = settingsStore.settings.api.reasoningTemplateName;
    }

    if (updatedProfile.apiUrl !== undefined) {
      if (currentProvider === api_providers.CUSTOM) {
        updatedProfile.apiUrl = settingsStore.settings.api.providerSpecific.custom.url;
      } else if (currentProvider === api_providers.KOBOLDCPP) {
        updatedProfile.apiUrl = settingsStore.settings.api.providerSpecific.koboldcpp.url;
      } else if (currentProvider === api_providers.OLLAMA) {
        updatedProfile.apiUrl = settingsStore.settings.api.providerSpecific.ollama.url;
      }
    }

    if (updatedProfile.secretId !== undefined) {
      const secretKey = getSecretKeyForProvider(currentProvider);
      if (secretKey) {
        const activeSecret = secretStore.secrets[secretKey]?.find((s) => s.active);
        if (activeSecret) {
          updatedProfile.secretId = activeSecret.id;
        }
      }
    }

    // Save back to store
    const newProfiles = [...connectionProfiles.value];
    newProfiles[profileIndex] = updatedProfile;
    connectionProfiles.value = newProfiles;
  }

  async function renameConnectionProfile() {
    const profile = connectionProfiles.value.find((p) => p.id === selectedConnectionProfile.value);
    if (!profile) {
      toast.error(t('apiConnections.profileManagement.errors.notFound'));
      return;
    }

    const oldName = profile.name;
    const { result, value: newName } = await popupStore.show<string>({
      title: t('apiConnections.profileManagement.renamePopupTitle'),
      type: POPUP_TYPE.INPUT,
      inputValue: oldName,
    });

    if (result === POPUP_RESULT.AFFIRMATIVE && newName && newName.trim() && newName !== oldName) {
      if (profile) {
        profile.name = newName;
        connectionProfiles.value = [...connectionProfiles.value];
      }
    }
  }

  async function deleteConnectionProfile() {
    const profile = connectionProfiles.value.find((p) => p.id === selectedConnectionProfile.value);
    if (!profile) {
      toast.error(t('apiConnections.profileManagement.errors.notFound'));
      return;
    }

    const { result } = await popupStore.show({
      title: t('common.confirmDelete'),
      content: t('apiConnections.profileManagement.deletePopupContent', { name: profile.name }),
      type: POPUP_TYPE.CONFIRM,
    });

    if (result === POPUP_RESULT.AFFIRMATIVE) {
      connectionProfiles.value = connectionProfiles.value.filter((p) => p.id !== selectedConnectionProfile.value);
      selectedConnectionProfile.value = undefined;
    }
  }

  function importConnectionProfiles() {
    toast.info('Importing profiles is not yet implemented.');
  }

  function exportConnectionProfile() {
    const profile = connectionProfiles.value.find((p) => p.id === selectedConnectionProfile.value);
    if (!profile) {
      toast.error(t('apiConnections.profileManagement.errors.noSelection'));
      return;
    }

    const content = JSON.stringify([profile], null, 2);
    downloadFile(content, `${profile.name}-profile.json`, 'application/json');
  }

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

  // Reasoning Templates
  async function loadReasoningTemplates() {
    try {
      const fetchedTemplates = await fetchAllReasoningTemplates();
      reasoningTemplates.value = fetchedTemplates;
    } catch (e) {
      console.warn('Failed to load reasoning templates', e);
      reasoningTemplates.value = [];
    }
  }

  async function saveReasoningTemplate(template: ReasoningTemplate) {
    try {
      await apiSaveReasoningTemplate(template);
      await loadReasoningTemplates();
      settingsStore.settings.api.reasoningTemplateName = template.name;
    } catch (e) {
      toast.error('Error saving reasoning template');
      console.error(e);
    }
  }

  async function deleteReasoningTemplate(name: string) {
    try {
      await apiDeleteReasoningTemplate(name);
      await loadReasoningTemplates();
      if (settingsStore.settings.api.reasoningTemplateName === name) {
        settingsStore.settings.api.reasoningTemplateName = undefined;
      }
    } catch {
      toast.error('Error deleting reasoning template');
    }
  }

  function importReasoningTemplate() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const content = await readFileAsText(file);
        const data = JSON.parse(content);
        await saveReasoningTemplate(data);
        toast.success('Template imported');
      } catch {
        toast.error('Invalid template file');
      }
    };
    input.click();
  }

  function exportReasoningTemplate(name: string) {
    const tpl = reasoningTemplates.value.find((t) => t.name === name);
    if (tpl) {
      downloadFile(JSON.stringify(tpl, null, 2), `${name}.json`, 'application/json');
    }
  }

  return {
    initialize,
    onlineStatus,
    isConnecting,
    connect,
    processPendingSecrets,
    activeModel,
    modelList,
    groupedOpenRouterModels,
    presets,
    loadPresetsForApi,
    saveCurrentPresetAs,
    updateCurrentPreset,
    renamePreset,
    deleteSamplerPreset,
    importPreset,
    exportPreset,
    updatePromptContent,
    resetPrompts,
    connectionProfiles,
    selectedConnectionProfile,
    createConnectionProfile,
    updateConnectionProfile,
    renameConnectionProfile,
    deleteConnectionProfile,
    importConnectionProfiles,
    exportConnectionProfile,
    selectConnectionProfile,
    instructTemplates,
    loadInstructTemplates,
    saveInstructTemplate,
    deleteInstructTemplate,
    importInstructTemplate,
    exportInstructTemplate,
    // Reasoning
    reasoningTemplates,
    loadReasoningTemplates,
    saveReasoningTemplate,
    deleteReasoningTemplate,
    importReasoningTemplate,
    exportReasoningTemplate,
  };
});
