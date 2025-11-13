import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { OaiSettings } from '../types';
import { chat_completion_sources } from '../types';
import { fetchChatCompletionStatus } from '../api/connection';
import { toast } from '../composables/useToast';
import { useSettingsStore } from './settings.store';
import { defaultsDeep, isEqual } from 'lodash-es';

export const useApiStore = defineStore('api', () => {
  const settingsStore = useSettingsStore();

  const mainApi = ref('openai');
  const oaiSettings = ref<Partial<OaiSettings>>({});
  const onlineStatus = ref('Not connected...');
  const isConnecting = ref(false);

  const defaultOaiSettings: Partial<OaiSettings> = {
    chat_completion_source: chat_completion_sources.OPENAI,
    api_key_openai: '',
    api_key_claude: '',
    model_openai_select: 'gpt-4o',
    model_claude_select: 'claude-3-5-sonnet-20240620',
  };

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
    () => {
      // Avoid connecting if settings are not initialized yet
      if (settingsStore.powerUser.send_on_enter === undefined) return;
      connect();
    },
  );

  async function connect() {
    if (isConnecting.value) return;

    if (mainApi.value !== 'openai') {
      onlineStatus.value = 'Not connected... (Not implemented)';
      return;
    }

    isConnecting.value = true;
    onlineStatus.value = 'Connecting...';

    try {
      // TODO: Implement secret management. For now, we pass the key directly.
      // TODO: Implement reverse proxy confirmation popup.
      const response = await fetchChatCompletionStatus(oaiSettings.value);

      if (response.error) {
        throw new Error(response.error);
      }

      onlineStatus.value = response.bypass ? 'Status check bypassed' : 'Valid';
      toast.success('Connected successfully!');
      // TODO: Handle model list from response
    } catch (error: any) {
      onlineStatus.value = 'No connection...';
      toast.error(error.message || 'Failed to connect.');
      console.error(error);
    } finally {
      isConnecting.value = false;
    }
  }

  return { mainApi, oaiSettings, onlineStatus, isConnecting, connect };
});
