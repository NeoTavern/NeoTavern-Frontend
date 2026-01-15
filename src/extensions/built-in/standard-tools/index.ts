import type { ExtensionAPI } from '../../../types';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { createUrlInspectorTool } from './tools/urlInspector';
import { createWebSearchTool } from './tools/webSearch';
import { DEFAULT_SETTINGS, type StandardToolsSettings } from './types';

export { manifest };

export function activate(api: ExtensionAPI<StandardToolsSettings>) {
  // Mount settings UI
  let settingsApp: { unmount: () => void } | null = null;
  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    settingsApp = api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  // Ensure default settings exist
  const currentSettings = api.settings.get();
  if (!currentSettings) {
    api.settings.set(undefined, DEFAULT_SETTINGS);
  }

  // Helper to get fresh settings inside tool execution
  const getSettings = () => api.settings.get() || DEFAULT_SETTINGS;

  // Register Tools
  const webSearchTool = createWebSearchTool(getSettings);
  const urlInspectorTool = createUrlInspectorTool(getSettings);

  const registerTools = async () => {
    await api.tools.register(webSearchTool);
    await api.tools.register(urlInspectorTool);
  };
  const unregisterTools = async () => {
    await api.tools.unregister(webSearchTool.name);
    await api.tools.unregister(urlInspectorTool.name);
  };

  // Initial registration
  registerTools();

  return () => {
    settingsApp?.unmount();
    unregisterTools();
  };
}
