export interface StandardToolsSettings {
  // General
  corsProxy: string;

  // Web Search Settings
  webSearchMaxResults: number;

  // URL Inspector Settings
  urlInspectorMaxContentLength: number;
}

export const DEFAULT_SETTINGS: StandardToolsSettings = {
  corsProxy: 'https://corsproxy.io/?',
  webSearchMaxResults: 5,
  urlInspectorMaxContentLength: 20000,
};
