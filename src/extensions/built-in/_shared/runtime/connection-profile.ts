import type { ExtensionAPI } from '../../../../types';

type ConnectionProfileSettingsAPI = {
  settings: Pick<ExtensionAPI['settings'], 'getGlobal'>;
};

export function resolveConnectionProfile(
  api: ConnectionProfileSettingsAPI,
  extensionProfile?: string,
): string | undefined {
  return extensionProfile || api.settings.getGlobal('api.selectedConnectionProfile');
}
