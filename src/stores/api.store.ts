import { defineStore } from 'pinia';
import { ref, watch, computed } from 'vue';
import type { ApiModel, OaiPrompt, OaiPromptOrderConfig, OaiSettings } from '../types';
import { POPUP_RESULT, POPUP_TYPE, chat_completion_sources } from '../types';
import { fetchChatCompletionStatus } from '../api/connection';
import { toast } from '../composables/useToast';
import { useSettingsStore } from './settings.store';
import { defaultsDeep, isEqual } from 'lodash-es';
import { useStrictI18n } from '../composables/useStrictI18n';
import { fetchAllPresets, savePreset, deletePreset as apiDeletePreset, type Preset } from '../api/presets';
import { usePopupStore } from './popup.store';
import { downloadFile, readFileAsText } from '../utils/file';

export const useApiStore = defineStore('api', () => {
  const { t } = useStrictI18n();

  const settingsStore = useSettingsStore();

  const mainApi = ref('openai');
  const oaiSettings = ref<OaiSettings>({} as OaiSettings);
  const onlineStatus = ref(t('api.status.notConnected'));
  const isConnecting = ref(false);
  const modelList = ref<ApiModel[]>([]);
  const presets = ref<Record<string, Preset[]>>({});

  const defaultOaiSettings: OaiSettings = {
    chat_completion_source: chat_completion_sources.OPENAI,
    openai_model: 'gpt-4o',
    claude_model: 'claude-sonnet-4-5',
    openrouter_model: 'OR_Website',
    temp_openai: 1.0,
    freq_pen_openai: 0,
    pres_pen_openai: 0,
    top_p_openai: 1,
    top_k_openai: 0,
    openai_max_context: 16384,
    openai_max_tokens: 500,
    stream_openai: true,
    proxy_password: '',
    reverse_proxy: '',
    prompts: [
      {
        name: 'Main Prompt',
        system_prompt: true,
        role: 'system',
        content: "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.",
        identifier: 'main',
      },
      { name: 'Post-History Instructions', system_prompt: true, role: 'system', content: '', identifier: 'jailbreak' },
      { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
      { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
      { identifier: 'charPersonality', name: 'Char Personality', system_prompt: true, marker: true },
      { identifier: 'scenario', name: 'Scenario', system_prompt: true, marker: true },
      { identifier: 'dialogueExamples', name: 'Chat Examples', system_prompt: true, marker: true },
      { identifier: 'worldInfoAfter', name: 'World Info (after)', system_prompt: true, marker: true },
      { identifier: 'worldInfoBefore', name: 'World Info (before)', system_prompt: true, marker: true },
    ] as OaiPrompt[],
    prompt_order: [
      {
        character_id: 100000,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'charDescription', enabled: true },
          { identifier: 'charPersonality', enabled: true },
          { identifier: 'scenario', enabled: true },
          { identifier: 'dialogueExamples', enabled: true },
          { identifier: 'worldInfoBefore', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: 'worldInfoAfter', enabled: true },
          { identifier: 'jailbreak', enabled: true },
        ],
      },
    ] as OaiPromptOrderConfig[],
  };

  const activeModel = computed(() => {
    switch (oaiSettings.value.chat_completion_source) {
      case chat_completion_sources.OPENAI:
        return oaiSettings.value.openai_model;
      case chat_completion_sources.CLAUDE:
        return oaiSettings.value.claude_model;
      case chat_completion_sources.OPENROUTER:
        return oaiSettings.value.openrouter_model;
      default:
        return oaiSettings.value.openai_model;
    }
  });

  const groupedOpenRouterModels = computed<Record<string, ApiModel[]> | null>(() => {
    if (
      oaiSettings.value.chat_completion_source !== chat_completion_sources.OPENROUTER ||
      modelList.value.length === 0
    ) {
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

  // When settings are loaded or changed from the backend, update our local API state.
  watch(
    () => settingsStore.settings,
    (newSettings) => {
      if (newSettings) {
        mainApi.value = newSettings.main_api || 'openai';
        oaiSettings.value = defaultsDeep({}, newSettings.oai_settings, defaultOaiSettings);
      } else {
        oaiSettings.value = { ...defaultOaiSettings };
      }
    },
    { deep: true, immediate: true },
  );

  // When the user changes API settings in the UI, save them back to the settings store.
  watch(mainApi, (newValue) => {
    if (settingsStore.settingsInitializing) return;
    if (newValue !== settingsStore.settings?.main_api) {
      settingsStore.setSetting('main_api', newValue);
    }
  });

  watch(
    oaiSettings,
    (newSettings) => {
      if (settingsStore.settingsInitializing) return;
      if (!isEqual(newSettings, settingsStore.settings?.oai_settings)) {
        settingsStore.setSetting('oai_settings', newSettings);
      }
    },
    { deep: true },
  );

  // When the main API or source changes, try to reconnect
  watch(
    () => [mainApi.value, oaiSettings.value.chat_completion_source],
    ([newMainApi, newSource], [oldMainApi, oldSource]) => {
      if (settingsStore.settingsInitializing) return;
      // Only connect if the actual values have changed
      if (newMainApi !== oldMainApi || newSource !== oldSource) {
        connect();
      }
    },
  );

  // When the user selects a different preset, apply its settings
  watch(
    () => oaiSettings.value.preset_settings_openai,
    (newPresetName) => {
      if (settingsStore.settingsInitializing || !newPresetName) return;

      const preset = presets.value.openai?.find((p) => p.name === newPresetName);
      if (preset) {
        Object.assign(oaiSettings.value, preset.preset);
      }
    },
  );

  async function connect() {
    if (isConnecting.value) return;

    modelList.value = [];

    if (mainApi.value !== 'openai') {
      onlineStatus.value = `${t('api.status.notConnected')} ${t('api.status.notImplemented')}`;
      return;
    }

    isConnecting.value = true;
    onlineStatus.value = t('api.status.connecting');

    try {
      // TODO: Implement secret management. For now, we pass the key directly.
      // TODO: Implement reverse proxy confirmation popup.
      const response = await fetchChatCompletionStatus(oaiSettings.value);

      if (response.error) {
        throw new Error(response.error);
      }

      if (response.data && Array.isArray(response.data)) {
        modelList.value = response.data;

        // Check if current model selection is still valid
        const source = oaiSettings.value.chat_completion_source;
        const availableModels = modelList.value.map((m) => m.id);

        if (source === chat_completion_sources.OPENAI) {
          if (!availableModels.includes(oaiSettings.value.openai_model ?? '')) {
            oaiSettings.value.openai_model = availableModels.length > 0 ? availableModels[0] : 'gpt-4o';
          }
        } else if (source === chat_completion_sources.OPENROUTER) {
          if (
            oaiSettings.value.openrouter_model !== 'OR_Website' &&
            !availableModels.includes(oaiSettings.value.openrouter_model ?? '')
          ) {
            oaiSettings.value.openrouter_model = availableModels.length > 0 ? availableModels[0] : 'OR_Website';
          }
        }
      }

      onlineStatus.value = response.bypass ? t('api.status.bypassed') : t('api.status.valid');
      toast.success(t('api.connectSuccess'));
    } catch (error: any) {
      onlineStatus.value = t('api.status.noConnection');
      toast.error(error.message || t('api.connectFailed'));
      console.error(error);
    } finally {
      isConnecting.value = false;
    }
  }

  async function loadPresetsForApi(apiId: string) {
    try {
      presets.value[apiId] = await fetchAllPresets(apiId);
    } catch (error) {
      console.error(`Failed to load presets for ${apiId}:`, error);
      toast.error(`Could not load presets for ${apiId}.`);
    }
  }

  async function saveCurrentPresetAs(apiId: string, name: string) {
    try {
      // Create a clean preset object from current settings
      const presetData: Partial<OaiSettings> = {
        temp_openai: oaiSettings.value.temp_openai,
        freq_pen_openai: oaiSettings.value.freq_pen_openai,
        pres_pen_openai: oaiSettings.value.pres_pen_openai,
        top_p_openai: oaiSettings.value.top_p_openai,
        top_k_openai: oaiSettings.value.top_k_openai,
        openai_max_context: oaiSettings.value.openai_max_context,
        openai_max_tokens: oaiSettings.value.openai_max_tokens,
        stream_openai: oaiSettings.value.stream_openai,
        // TODO: Add all other settings that should be part of a preset
      };
      await savePreset(apiId, name, presetData);
      await loadPresetsForApi(apiId);
      oaiSettings.value.preset_settings_openai = name;
      toast.success(`Preset "${name}" saved.`);
    } catch (error) {
      toast.error(`Failed to save preset "${name}".`);
    }
  }

  function updateCurrentPreset(apiId: string, name?: string) {
    if (!name || name === 'Default') {
      toast.warning(t('aiConfig.presets.errors.updateDefault'));
      return;
    }
    saveCurrentPresetAs(apiId, name);
  }

  async function renamePreset(apiId: string, oldName?: string) {
    if (!oldName || oldName === 'Default') {
      toast.warning(t('aiConfig.presets.errors.renameDefault'));
      return;
    }
    const popupStore = usePopupStore();
    const { result, value: newName } = await popupStore.show({
      title: t('aiConfig.presets.renamePopupTitle'),
      type: POPUP_TYPE.INPUT,
      inputValue: oldName,
    });

    if (result === POPUP_RESULT.AFFIRMATIVE && newName && newName.trim() && newName !== oldName) {
      try {
        const presetToRename = presets.value[apiId]?.find((p) => p.name === oldName);
        if (!presetToRename) throw new Error('Preset not found');

        // Rename is a delete and save operation
        await apiDeletePreset(apiId, oldName);
        await savePreset(apiId, newName, presetToRename.preset);

        toast.success(`Preset renamed to "${newName}".`);
        await loadPresetsForApi(apiId);
        oaiSettings.value.preset_settings_openai = newName;
      } catch (error) {
        toast.error('Failed to rename preset.');
        console.error(error);
      }
    }
  }

  async function deletePreset(apiId: string, name?: string) {
    if (!name || name === 'Default') {
      toast.warning(t('aiConfig.presets.errors.deleteDefault'));
      return;
    }
    const popupStore = usePopupStore();
    const { result } = await popupStore.show({
      title: t('common.confirmDelete'),
      content: t('aiConfig.presets.deletePopupContent', { name }),
      type: POPUP_TYPE.CONFIRM,
    });

    if (result === POPUP_RESULT.AFFIRMATIVE) {
      try {
        await apiDeletePreset(apiId, name);
        toast.success(`Preset "${name}" deleted.`);
        if (oaiSettings.value.preset_settings_openai === name) {
          oaiSettings.value.preset_settings_openai = 'Default';
        }
        await loadPresetsForApi(apiId);
      } catch (error) {
        toast.error(`Failed to delete preset "${name}".`);
      }
    }
  }

  function importPreset(apiId: string) {
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
        await savePreset(apiId, name, presetData);
        toast.success(`Preset "${name}" imported.`);
        await loadPresetsForApi(apiId);
        oaiSettings.value.preset_settings_openai = name;
      } catch (error) {
        toast.error(t('aiConfig.presets.errors.importInvalid'));
        console.error(error);
      }
    };
    input.click();
  }

  function exportPreset(apiId: string, name?: string) {
    if (!name) {
      toast.error(t('aiConfig.presets.errors.noExportSelected'));
      return;
    }
    const presetToExport = presets.value[apiId]?.find((p) => p.name === name);
    if (!presetToExport) {
      toast.error(t('aiConfig.presets.errors.exportNotFound', { name }));
      return;
    }

    const content = JSON.stringify(presetToExport.preset, null, 2);
    downloadFile(content, `${name}.json`, 'application/json');
  }

  // --- Prompt Management ---
  function updatePromptOrder(newOrder: OaiPromptOrderConfig['order']) {
    if (oaiSettings.value.prompt_order && oaiSettings.value.prompt_order[0]) {
      oaiSettings.value.prompt_order[0].order = newOrder;
    }
  }

  function togglePromptEnabled(identifier: string, enabled: boolean) {
    const orderItem = oaiSettings.value.prompt_order?.[0].order.find((p) => p.identifier === identifier);
    if (orderItem) {
      orderItem.enabled = enabled;
    }
  }

  function updatePromptContent(identifier: string, content: string) {
    const prompt = oaiSettings.value.prompts?.find((p) => p.identifier === identifier);
    if (prompt) {
      prompt.content = content;
    }
  }

  function resetPrompts() {
    oaiSettings.value.prompts = JSON.parse(JSON.stringify(defaultOaiSettings.prompts));
    oaiSettings.value.prompt_order = JSON.parse(JSON.stringify(defaultOaiSettings.prompt_order));
  }

  return {
    mainApi,
    oaiSettings,
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
    deletePreset,
    importPreset,
    exportPreset,
    updatePromptOrder,
    togglePromptEnabled,
    updatePromptContent,
    resetPrompts,
  };
});
