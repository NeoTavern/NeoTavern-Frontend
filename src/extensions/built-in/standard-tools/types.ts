export interface StandardToolsSettings {
  // General
  corsProxy: string;

  // Web Search Settings
  webSearchMaxResults: number;

  // URL Inspector Settings
  urlInspectorMaxContentLength: number;
  useFandomApi: boolean;
}

export const DEFAULT_SETTINGS: StandardToolsSettings = {
  corsProxy: '',
  webSearchMaxResults: 5,
  urlInspectorMaxContentLength: 20000,
  useFandomApi: true,
};
