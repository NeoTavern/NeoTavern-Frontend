import { defineStore } from 'pinia';
import { ref, watch, computed } from 'vue';
import type { ApiModel, SamplerSettings, PromptOrderConfig } from '../types';
import { POPUP_RESULT, POPUP_TYPE, chat_completion_sources } from '../types';
import { fetchChatCompletionStatus } from '../api/connection';
import { toast } from '../composables/useToast';
import { useSettingsStore } from './settings.store';
import { useStrictI18n } from '../composables/useStrictI18n';
import {
  fetchAllExperimentalPresets,
  saveExperimentalPreset,
  deletePreset as apiDeletePreset,
  type Preset,
} from '../api/presets';
import { usePopupStore } from './popup.store';
import { downloadFile, readFileAsText } from '../utils/file';
import { defaultPromptOrder, defaultPrompts } from '../constants';

export const useApiStore = defineStore('api', () => {
  const { t } = useStrictI18n();
  const settingsStore = useSettingsStore();

  const onlineStatus = ref(t('api.status.notConnected'));
  const isConnecting = ref(false);
  const modelList = ref<ApiModel[]>([]);
  const presets = ref<Preset[]>([]);

  const activeModel = computed(() => {
    switch (settingsStore.settings.api.chat_completion_source) {
      case chat_completion_sources.OPENAI:
        return settingsStore.settings.api.openai_model;
      case chat_completion_sources.CLAUDE:
        return settingsStore.settings.api.claude_model;
      case chat_completion_sources.OPENROUTER:
        return settingsStore.settings.api.openrouter_model;
      default:
        return settingsStore.settings.api.openai_model;
    }
  });

  const groupedOpenRouterModels = computed<Record<string, ApiModel[]> | null>(() => {
    if (
      settingsStore.settings.api.chat_completion_source !== chat_completion_sources.OPENROUTER ||
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

  // When the main API or source changes, try to reconnect
  watch(
    () => [settingsStore.settings.api.main, settingsStore.settings.api.chat_completion_source],
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
    () => settingsStore.settings.api.selected_sampler,
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

    if (settingsStore.settings.api.main !== 'openai') {
      onlineStatus.value = `${t('api.status.notConnected')} ${t('api.status.notImplemented')}`;
      return;
    }

    isConnecting.value = true;
    onlineStatus.value = t('api.status.connecting');

    try {
      // TODO: Implement secret management. For now, we pass the key directly.
      // TODO: Implement reverse proxy confirmation popup.
      const response = await fetchChatCompletionStatus(settingsStore.settings.api);

      if (response.error) {
        throw new Error(response.error);
      }

      if (response.data && Array.isArray(response.data)) {
        modelList.value = response.data;

        // Check if current model selection is still valid
        const source = settingsStore.settings.api.chat_completion_source;
        const availableModels = modelList.value.map((m) => m.id);

        if (source === chat_completion_sources.OPENAI) {
          if (!availableModels.includes(settingsStore.settings.api.openai_model ?? '')) {
            settingsStore.settings.api.openai_model = availableModels.length > 0 ? availableModels[0] : 'gpt-4o';
          }
        } else if (source === chat_completion_sources.OPENROUTER) {
          if (
            settingsStore.settings.api.openrouter_model !== 'OR_Website' &&
            !availableModels.includes(settingsStore.settings.api.openrouter_model ?? '')
          ) {
            settingsStore.settings.api.openrouter_model =
              availableModels.length > 0 ? availableModels[0] : 'OR_Website';
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

  async function loadPresetsForApi() {
    try {
      presets.value = await fetchAllExperimentalPresets();
    } catch (error) {
      console.error('Failed to load presets:', error);
      toast.error('Could not load presets.');
    }
  }

  async function saveCurrentPresetAs(apiId: string, name: string) {
    try {
      // Create a clean preset object from current samplers
      const presetData: SamplerSettings = { ...settingsStore.settings.api.samplers };

      await saveExperimentalPreset(name, presetData);
      await loadPresetsForApi();
      settingsStore.settings.api.selected_sampler = name;
      toast.success(`Preset "${name}" saved.`);
    } catch (error) {
      toast.error(`Failed to save preset "${name}".`);
    }
  }

  function updateCurrentPreset(apiId: string, name?: string) {
    if (!name) {
      toast.warning(t('aiConfig.presets.errors.noPresetName'));
      return;
    }
    saveCurrentPresetAs(apiId, name);
  }

  async function renamePreset(apiId: string, oldName?: string) {
    if (!oldName) {
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
        const presetToRename = presets.value.find((p) => p.name === oldName);
        if (!presetToRename) throw new Error('Preset not found');

        // Rename is a delete and save operation
        await apiDeletePreset(oldName);
        await saveExperimentalPreset(newName, presetToRename.preset);

        toast.success(`Preset renamed to "${newName}".`);
        await loadPresetsForApi();
        settingsStore.settings.api.selected_sampler = newName;
      } catch (error) {
        toast.error('Failed to rename preset.');
        console.error(error);
      }
    }
  }

  async function deletePreset(apiId: string, name?: string) {
    if (!name) {
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
        await apiDeletePreset(name);
        toast.success(`Preset "${name}" deleted.`);
        if (settingsStore.settings.api.selected_sampler === name) {
          settingsStore.settings.api.selected_sampler = 'Default';
        }
        await loadPresetsForApi();
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
        await saveExperimentalPreset(name, presetData);
        toast.success(`Preset "${name}" imported.`);
        await loadPresetsForApi();
        settingsStore.settings.api.selected_sampler = name;
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
    const presetToExport = presets.value.find((p) => p.name === name);
    if (!presetToExport) {
      toast.error(t('aiConfig.presets.errors.exportNotFound', { name }));
      return;
    }

    const content = JSON.stringify(presetToExport.preset, null, 2);
    downloadFile(content, `${name}.json`, 'application/json');
  }

  // --- Prompt Management ---
  function updatePromptOrder(newOrder: PromptOrderConfig['order']) {
    if (settingsStore.settings.api.samplers.prompt_order) {
      settingsStore.settings.api.samplers.prompt_order.order = newOrder;
    }
  }

  function removePromptFromOrder(identifier: string) {
    const promptOrder = settingsStore.settings.api.samplers.prompt_order;
    if (promptOrder) {
      promptOrder.order = promptOrder.order.filter((p) => p.identifier !== identifier);
    }
  }

  function addPromptToOrder(identifier: string) {
    const promptOrder = settingsStore.settings.api.samplers.prompt_order;
    if (promptOrder) {
      if (promptOrder.order.some((p) => p.identifier === identifier)) return;
      promptOrder.order.push({ identifier, enabled: true });
    }
  }

  function togglePromptEnabled(identifier: string, enabled: boolean) {
    const orderItem = settingsStore.settings.api.samplers.prompt_order?.order.find((p) => p.identifier === identifier);
    if (orderItem) {
      orderItem.enabled = enabled;
    }
  }

  function updatePromptContent(identifier: string, content: string) {
    const prompt = settingsStore.settings.api.samplers.prompts?.find((p) => p.identifier === identifier);
    if (prompt) {
      prompt.content = content;
    }
  }

  function resetPrompts() {
    settingsStore.settings.api.samplers.prompts = JSON.parse(JSON.stringify(defaultPrompts));
    settingsStore.settings.api.samplers.prompt_order = JSON.parse(JSON.stringify(defaultPromptOrder));
  }

  return {
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
    removePromptFromOrder,
    addPromptToOrder,
    togglePromptEnabled,
    updatePromptContent,
    resetPrompts,
  };
});
