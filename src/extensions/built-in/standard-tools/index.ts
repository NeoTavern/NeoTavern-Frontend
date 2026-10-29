import type { ExtensionAPI } from '../../../types';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { createUrlInspectorTool } from './tools/urlInspector';
import { createWebSearchTool } from './tools/webSearch';
import { DEFAULT_SETTINGS, type StandardToolsSettings } from './types';

export { manifest };

export function activate(api: ExtensionAPI<StandardToolsSettings>) {
  // Mount settings UI
  api.ui.registerSettingsPanel(SettingsPanel, { api });

  // Ensure default settings exist
  const currentSettings = api.settings.get();
  if (!currentSettings) {
    api.settings.set(undefined, DEFAULT_SETTINGS);
  }

  // Helper to get fresh settings inside tool execution
  const getSettings = () => ({ ...DEFAULT_SETTINGS, ...api.settings.get() });

  // Register Tools
  const webSearchTool = createWebSearchTool(getSettings);
  const urlInspectorTool = createUrlInspectorTool(getSettings);

  const registerTools = async () => {
    await api.tools.register(webSearchTool);
    await api.tools.register(urlInspectorTool);
  };

  // Initial registration
  registerTools();

  return () => {};
}
