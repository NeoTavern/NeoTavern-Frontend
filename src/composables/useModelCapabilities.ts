import { computed } from 'vue';
import { getModelCapabilities, type ModelCapabilities } from '../api/provider-definitions';
import { useApiStore } from '../stores/api.store';
import { useSettingsStore } from '../stores/settings.store';

export function useModelCapabilities() {
  const settingsStore = useSettingsStore();
  const apiStore = useApiStore();

  const capabilities = computed<ModelCapabilities>(() => {
    const provider = settingsStore.settings.api.provider;
    const model = apiStore.activeModel ?? '';
    return getModelCapabilities(provider, model, apiStore.modelList);
  });

  function hasCapability(capability: keyof ModelCapabilities): boolean {
    return capabilities.value[capability];
  }

  return {
    capabilities,
    hasCapability,
  };
}
