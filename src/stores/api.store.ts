import { cloneDeep } from 'lodash-es';
import { defineStore } from 'pinia';
import { computed, ref, watch, type Ref } from 'vue';
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
import { getUrlConfiguredProvider, resolveSupportedFormatter } from '../api/provider-definitions';
import { useStrictI18n } from '../composables/useStrictI18n';
import { toast } from '../composables/useToast';
import { defaultPrompts, PROVIDER_SECRET_KEYS } from '../constants';
import { migrateLegacyOaiPreset, migrateLegacyTextCompletionPreset } from '../services/settings-migration.service';
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
import { downloadFile, pickFile, readFileAsText, uuidv4 } from '../utils/commons';
import { normalizeSamplerSettings } from '../utils/sampler-settings';
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
  const presets = ref<Preset<SamplerSettings>[]>([]);
  const samplerPresetsLoaded = ref(false);
  const modelsByProvider = ref<Map<ApiProvider, ApiModel[]>>(new Map());

  const modelList = computed(() => {
    const currentProvider = settingsStore.settings.api.provider;
    return modelsByProvider.value.get(currentProvider) ?? [];
  });

  const instructTemplates = ref<InstructTemplate[]>([]);
  const reasoningTemplates = ref<ReasoningTemplate[]>([]);
  const instructTemplatesLoaded = ref(false);
  const reasoningTemplatesLoaded = ref(false);

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

    await connect({ notifySuccess: false });
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
          settingsStore.settings.api.formatter = resolveSupportedFormatter(
            newProvider,
            settingsStore.settings.api.formatter,
          );
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
          settingsStore.settings.api.samplers = normalizeSamplerSettings(preset.preset);
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
    if (profile.sampler) {
      if (!samplerPresetsLoaded.value) {
        await loadPresetsForApi();
      }

      const samplerExists = presets.value.some((preset) => preset.name === profile.sampler);
      if (samplerExists) {
        if (profile.sampler !== settingsStore.settings.api.selectedSampler) {
          settingsStore.settings.api.selectedSampler = profile.sampler;
        }
      } else if (samplerPresetsLoaded.value) {
        removeStaleSamplerFromConnectionProfile(profile.id, profile.sampler);
      }
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
    const urlProvider = getUrlConfiguredProvider(profile.provider ?? settingsStore.settings.api.provider);
    if (profile.apiUrl !== undefined && urlProvider) {
      settingsStore.settings.api.providerSpecific[urlProvider].url = profile.apiUrl;
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

    settingsStore.settings.api.formatter = resolveSupportedFormatter(
      settingsStore.settings.api.provider,
      settingsStore.settings.api.formatter,
    );
    connect();
  }

  /** Fetches the provider's status (and model list) with the current connection settings. */
  function fetchProviderStatus(provider: ApiProvider) {
    const apiSettings = settingsStore.settings.api;
    if (provider === api_providers.KOBOLDCPP) {
      // We could use kobold CC models endpoint too. It's just a preference.
      return fetchTextCompletionStatus({
        api_type: 'koboldcpp',
        api_server: apiSettings.providerSpecific.koboldcpp.url.replace(/\/v1(?:.*)?$/, ''),
      });
    }
    if (provider === api_providers.OLLAMA) {
      return fetchChatCompletionStatus({
        chat_completion_source: 'custom',
        custom_url: apiSettings.providerSpecific.ollama.url,
      });
    }
    return fetchChatCompletionStatus({
      chat_completion_source: provider,
      reverse_proxy: apiSettings.proxy?.url,
      proxy_password: apiSettings.proxy?.password,
      custom_url: provider === api_providers.CUSTOM ? apiSettings.providerSpecific.custom.url : undefined,
    });
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

  async function connect(options: { notifySuccess?: boolean } = {}) {
    if (isConnecting.value) return;

    isConnecting.value = true;
    onlineStatus.value = t('api.status.connecting');

    const apiSettings = settingsStore.settings.api;

    try {
      await processPendingSecrets();

      const response = await fetchProviderStatus(apiSettings.provider);

      if (response.error) {
        throw new Error(response.error);
      }

      const models = response.data && Array.isArray(response.data) ? response.data : [];
      modelsByProvider.value.set(apiSettings.provider, models);

      if (
        (apiSettings.provider === api_providers.KOBOLDCPP || apiSettings.provider === api_providers.OLLAMA) &&
        models.length > 0
      ) {
        const currentModel = apiSettings.selectedProviderModels[apiSettings.provider];
        if (!currentModel) {
          apiSettings.selectedProviderModels[apiSettings.provider] = models[0].id;
        }
      }

      onlineStatus.value = response.bypass ? t('api.status.bypassed') : t('api.status.valid');
      if (options.notifySuccess !== false) {
        toast.success(t('api.connectSuccess'));
      }
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (error as any).message || t('api.connectFailed');
      onlineStatus.value = t('api.status.noConnection');
      toast.error(msg);
      console.error(error);
      modelsByProvider.value.set(apiSettings.provider, []);
    } finally {
      isConnecting.value = false;
    }
  }

  async function loadPresetsForApi(): Promise<boolean> {
    try {
      presets.value = await fetchAllSamplerPresets();
      samplerPresetsLoaded.value = true;
      return true;
    } catch (error) {
      console.error('Failed to load presets:', error);
      toast.error('Could not load presets.');
      return false;
    }
  }

  function removeStaleSamplerFromConnectionProfile(profileId: string, staleSampler: string) {
    const profileIndex = connectionProfiles.value.findIndex((p) => p.id === profileId);
    if (profileIndex === -1) return;

    const updatedProfile = { ...connectionProfiles.value[profileIndex] };
    delete updatedProfile.sampler;

    const newProfiles = [...connectionProfiles.value];
    newProfiles[profileIndex] = updatedProfile;
    connectionProfiles.value = newProfiles;

    toast.warning(
      t('apiConnections.profileManagement.staleSamplerRemoved', {
        profile: updatedProfile.name,
        sampler: staleSampler,
      }),
    );
  }

  async function saveCurrentPresetAs(name: string) {
    try {
      const presetData: SamplerSettings = normalizeSamplerSettings(settingsStore.settings.api.samplers);
      settingsStore.settings.api.samplers = cloneDeep(presetData);
      await saveSamplerPreset(name, presetData);
      const existingIndex = presets.value.findIndex((p) => p.name === name);
      if (existingIndex >= 0) {
        presets.value[existingIndex] = { name, preset: presetData };
      } else {
        presets.value.push({ name, preset: presetData });
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
        const renamedPreset = normalizeSamplerSettings(presetToRename.preset);
        await saveSamplerPreset(newName, renamedPreset);

        presets.value = presets.value.filter((p) => p.name !== oldName);
        presets.value.push({ name: newName, preset: renamedPreset });
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
      // Update UI optimistically
      const previousPresets = [...presets.value];
      const previousSelection = settingsStore.settings.api.selectedSampler;

      if (settingsStore.settings.api.selectedSampler === name) {
        settingsStore.settings.api.selectedSampler = 'Default';
      }
      presets.value = presets.value.filter((p) => p.name !== name);

      try {
        await apideleteSamplerPreset(name);
      } catch (error: unknown) {
        // Revert on error
        presets.value = previousPresets;
        settingsStore.settings.api.selectedSampler = previousSelection;
        toast.error(`Failed to delete preset "${name}".`);
        console.error('Failed to delete preset:', error);
      }
    }
  }

  function importPreset() {
    pickFile('.json', async (file) => {
      try {
        const content = await readFileAsText(file);
        let presetData = JSON.parse(content);
        const name = file.name.replace(/\.json$/, '');

        // Detect and migrate legacy formats
        if ('openai_max_context' in presetData || 'prompt_order' in presetData) {
          try {
            presetData = migrateLegacyOaiPreset(presetData as LegacyOaiPresetSettings);
            toast.success(t('aiConfig.presets.messages.migrateSuccess'));
          } catch (error) {
            console.error('Migration failed:', error);
            toast.error(t('aiConfig.presets.errors.migrateFailed'));
            return;
          }
        } else if ('temp' in presetData || 'genamt' in presetData || 'rep_pen' in presetData) {
          // Text completion (Kobold-style) preset
          try {
            presetData = migrateLegacyTextCompletionPreset(presetData);
            toast.success(t('aiConfig.presets.messages.migrateTextCompletion'));
          } catch (error) {
            console.error('Text completion migration failed:', error);
            toast.error(t('aiConfig.presets.errors.migrateFailed'));
            return;
          }
        }

        // Validate preset structure
        const requiredFields = ['temperature', 'max_context', 'max_tokens'];
        const missingFields = requiredFields.filter((field) => !(field in presetData));

        if (missingFields.length > 0) {
          toast.error(t('aiConfig.presets.errors.missingFields', { fields: missingFields.join(', ') }));
          console.error('Invalid preset: missing fields', missingFields);
          return;
        }

        // Validate field types
        if (
          typeof presetData.temperature !== 'number' ||
          typeof presetData.max_context !== 'number' ||
          typeof presetData.max_tokens !== 'number'
        ) {
          toast.error(t('aiConfig.presets.errors.invalidFieldTypes'));
          console.error('Invalid preset: incorrect field types');
          return;
        }

        presetData = normalizeSamplerSettings(presetData);

        // Update UI optimistically
        const existingIndex = presets.value.findIndex((p) => p.name === name);
        const previousPresets = [...presets.value];
        const previousSelection = settingsStore.settings.api.selectedSampler;

        if (existingIndex >= 0) {
          presets.value[existingIndex] = { name, preset: presetData };
        } else {
          presets.value.push({ name, preset: presetData });
        }
        settingsStore.settings.api.selectedSampler = name;

        try {
          // TODO: Add confirmation for overwriting existing preset, like original ST
          await saveSamplerPreset(name, presetData);
        } catch (error) {
          // Revert on error
          presets.value = previousPresets;
          settingsStore.settings.api.selectedSampler = previousSelection;
          toast.error(t('aiConfig.presets.errors.importInvalid'));
          console.error(error);
        }
      } catch (error) {
        toast.error(t('aiConfig.presets.errors.importInvalid'));
        console.error(error);
      }
    });
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
    const profileIndex = connectionProfiles.value.findIndex((p) => p.id === selectedConnectionProfile.value);
    if (profileIndex === -1) {
      toast.error(t('apiConnections.profileManagement.errors.noSelection'));
      return;
    }

    const profile = connectionProfiles.value[profileIndex];
    // Create a copy to update
    const updatedProfile: ConnectionProfile = { ...profile };
    const changes: string[] = [];

    // Update only fields that exist in the profile
    const currentProvider = settingsStore.settings.api.provider;

    if (updatedProfile.provider) {
      if (updatedProfile.provider !== currentProvider) {
        changes.push(t('apiConnections.provider'));
        updatedProfile.provider = currentProvider;
      }
    }

    if (updatedProfile.model !== undefined) {
      // Model depends on provider, but since we are updating with current settings,
      // we take the model that is currently selected for the current provider
      const newModel = settingsStore.settings.api.selectedProviderModels[currentProvider];
      if (updatedProfile.model !== newModel) {
        changes.push(t('common.model')); // "Model"
        updatedProfile.model = newModel;
      }
    }

    if (updatedProfile.sampler) {
      const newSampler = settingsStore.settings.api.selectedSampler;
      if (updatedProfile.sampler !== newSampler) {
        changes.push(t('aiConfig.tabSampler'));
        updatedProfile.sampler = newSampler;
      }
    }

    if (updatedProfile.formatter) {
      const newFormatter = settingsStore.settings.api.formatter;
      if (updatedProfile.formatter !== newFormatter) {
        changes.push(t('apiConnections.formatter'));
        updatedProfile.formatter = newFormatter;
      }
    }

    if (updatedProfile.customPromptPostProcessing !== undefined) {
      const newCPPP = settingsStore.settings.api.customPromptPostProcessing;
      if (updatedProfile.customPromptPostProcessing !== newCPPP) {
        changes.push(t('apiConnections.postProcessing.label'));
        updatedProfile.customPromptPostProcessing = newCPPP;
      }
    }

    if (updatedProfile.instructTemplate) {
      const newIT = settingsStore.settings.api.instructTemplateName;
      if (updatedProfile.instructTemplate !== newIT) {
        changes.push(t('apiConnections.instructTemplate.label'));
        updatedProfile.instructTemplate = newIT;
      }
    }

    if (updatedProfile.reasoningTemplate) {
      const newRT = settingsStore.settings.api.reasoningTemplateName;
      if (updatedProfile.reasoningTemplate !== newRT) {
        changes.push(t('apiConnections.reasoningTemplate.label'));
        updatedProfile.reasoningTemplate = newRT;
      }
    }

    const urlProvider = getUrlConfiguredProvider(currentProvider);
    if (updatedProfile.apiUrl !== undefined && urlProvider) {
      const newUrl = settingsStore.settings.api.providerSpecific[urlProvider].url;
      if (updatedProfile.apiUrl !== newUrl) {
        changes.push(t('apiConnections.apiUrl'));
        updatedProfile.apiUrl = newUrl;
      }
    }

    if (updatedProfile.secretId !== undefined) {
      const secretKey = getSecretKeyForProvider(currentProvider);
      if (secretKey) {
        const activeSecret = secretStore.secrets[secretKey]?.find((s) => s.active);
        if (activeSecret && updatedProfile.secretId !== activeSecret.id) {
          changes.push(t('apiConnections.secretId'));
          updatedProfile.secretId = activeSecret.id;
        }
      }
    }

    // Save back to store
    const newProfiles = [...connectionProfiles.value];
    newProfiles[profileIndex] = updatedProfile;
    connectionProfiles.value = newProfiles;

    if (changes.length > 0) {
      toast.success(t('apiConnections.profileManagement.updatedFields', { fields: changes.join(', ') }));
    } else {
      toast.info(t('apiConnections.profileManagement.noChanges'));
    }
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

  /**
   * Load/save/delete/import/export for a server-stored template list whose selection lives in `api[settingKey]`.
   */
  function createTemplateCollection<T extends { name: string }>(options: {
    templates: Ref<T[]>;
    loaded: Ref<boolean>;
    fetchAll: () => Promise<T[]>;
    save: (template: T) => Promise<unknown>;
    remove: (name: string) => Promise<unknown>;
    settingKey: 'instructTemplateName' | 'reasoningTemplateName';
    /** Selection to fall back to when the selected template is deleted. */
    fallbackName: string | undefined;
    label: string;
  }) {
    const { templates, loaded, settingKey, label } = options;

    async function load() {
      if (loaded.value) return;
      try {
        templates.value = await options.fetchAll();
      } catch (e) {
        console.warn(`Failed to load ${label}s`, e);
        templates.value = [];
      } finally {
        loaded.value = true;
      }
    }

    async function save(template: T) {
      try {
        await options.save(template);
        loaded.value = false;
        await load();
        settingsStore.settings.api[settingKey] = template.name;
      } catch (e) {
        toast.error(`Error saving ${label}`);
        console.error(e);
      }
    }

    async function remove(name: string) {
      try {
        await options.remove(name);
        loaded.value = false;
        await load();
        if (settingsStore.settings.api[settingKey] === name) {
          settingsStore.settings.api[settingKey] = options.fallbackName as string;
        }
      } catch {
        toast.error(`Error deleting ${label}`);
      }
    }

    function importFromFile() {
      pickFile('.json', async (file) => {
        try {
          await save(JSON.parse(await readFileAsText(file)));
          toast.success('Template imported');
        } catch {
          toast.error('Invalid template file');
        }
      });
    }

    function exportToFile(name: string) {
      const template = templates.value.find((t) => t.name === name);
      if (template) {
        downloadFile(JSON.stringify(template, null, 2), `${name}.json`, 'application/json');
      }
    }

    return { load, save, remove, importFromFile, exportToFile };
  }

  const instructTemplateCollection = createTemplateCollection({
    templates: instructTemplates,
    loaded: instructTemplatesLoaded,
    fetchAll: fetchAllInstructTemplates,
    save: apiSaveInstructTemplate,
    remove: apiDeleteInstructTemplate,
    settingKey: 'instructTemplateName',
    fallbackName: 'ChatML',
    label: 'instruct template',
  });

  const reasoningTemplateCollection = createTemplateCollection({
    templates: reasoningTemplates,
    loaded: reasoningTemplatesLoaded,
    fetchAll: fetchAllReasoningTemplates,
    save: apiSaveReasoningTemplate,
    remove: apiDeleteReasoningTemplate,
    settingKey: 'reasoningTemplateName',
    fallbackName: undefined,
    label: 'reasoning template',
  });

  async function getModelsForProvider(provider: ApiProvider): Promise<ApiModel[]> {
    const shouldSkipCache = provider === api_providers.KOBOLDCPP || provider === api_providers.OLLAMA;

    if (!shouldSkipCache && modelsByProvider.value.has(provider)) {
      return modelsByProvider.value.get(provider)!;
    }

    try {
      const response = await fetchProviderStatus(provider);

      if (response.error) {
        console.error(`Failed to fetch models for ${provider}:`, response.error);
        return [];
      }

      const models = response.data && Array.isArray(response.data) ? response.data : [];
      if (!shouldSkipCache) {
        modelsByProvider.value.set(provider, models);
      }
      return models;
    } catch (error) {
      console.error(`Failed to fetch models for ${provider}:`, error);
      return [];
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
    loadInstructTemplates: instructTemplateCollection.load,
    saveInstructTemplate: instructTemplateCollection.save,
    deleteInstructTemplate: instructTemplateCollection.remove,
    importInstructTemplate: instructTemplateCollection.importFromFile,
    exportInstructTemplate: instructTemplateCollection.exportToFile,
    // Reasoning
    reasoningTemplates,
    loadReasoningTemplates: reasoningTemplateCollection.load,
    saveReasoningTemplate: reasoningTemplateCollection.save,
    deleteReasoningTemplate: reasoningTemplateCollection.remove,
    importReasoningTemplate: reasoningTemplateCollection.importFromFile,
    exportReasoningTemplate: reasoningTemplateCollection.exportToFile,
    getModelsForProvider,
  };
});
