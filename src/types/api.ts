import type { I18nKey } from './i18n';
import type { SettingsPath } from './settings';

export const chat_completion_sources = {
  OPENAI: 'openai',
  CLAUDE: 'claude',
  OPENROUTER: 'openrouter',
  AI21: 'ai21',
  MAKERSUITE: 'makersuite',
  VERTEXAI: 'vertexai',
  MISTRALAI: 'mistralai',
  CUSTOM: 'custom',
  COHERE: 'cohere',
  PERPLEXITY: 'perplexity',
  GROQ: 'groq',
  ELECTRONHUB: 'electronhub',
  NANOGPT: 'nanogpt',
  DEEPSEEK: 'deepseek',
  AIMLAPI: 'aimlapi',
  XAI: 'xai',
  POLLINATIONS: 'pollinations',
  MOONSHOT: 'moonshot',
  FIREWORKS: 'fireworks',
  COMETAPI: 'cometapi',
  AZURE_OPENAI: 'azure_openai',
  ZAI: 'zai',
} as const;

export type ChatCompletionSource = (typeof chat_completion_sources)[keyof typeof chat_completion_sources];

export interface ConnectionProfile {
  id: string;
  name: string;
  api?: string;
  chat_completion_source?: ChatCompletionSource;
  model?: string;
  sampler?: string;
}

export interface ApiModel {
  id: string;
  name?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface AiConfigCondition {
  api?: string | string[];
  source?: ChatCompletionSource | ChatCompletionSource[];
}

// TODO: Some values might change based on model/source, e.g., max tokens
export interface AiConfigItem {
  id?: SettingsPath;
  widget:
    | 'preset-manager'
    | 'slider'
    | 'number-input'
    | 'checkbox'
    | 'select'
    | 'textarea'
    | 'text-input'
    | 'key-manager'
    | 'model-select'
    | 'custom-component'
    | 'info-display'
    | 'prompt-manager-button'
    | 'hr'
    | 'header';
  apiId?: string; // For preset manager to know which API it controls
  label?: I18nKey; // i18n key for the label
  description?: I18nKey; // i18n key for text below the control
  infoTooltip?: I18nKey; // i18n key for the (i) icon
  infoLink?: string; // URL for docs link
  conditions?: AiConfigCondition;

  // For slider/number
  min?: number;
  max?: number;
  step?: number;
  maxUnlockedId?: SettingsPath;
  unlockLabel?: I18nKey;
  unlockTooltip?: I18nKey;

  // for select
  options?: { value: string | number; label: I18nKey | string }[]; // Label can be i18n key or string
  placeholder?: string; // For text/number inputs

  // for custom components
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: any; // TODO: Implement

  // For layout
  cssClass?: string; // TODO: Implement

  // For info-display
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  valueGetter?: (apiStore: any) => string; // TODO: Implement
}

export interface AiConfigSection {
  id: string;
  conditions?: AiConfigCondition;
  items: AiConfigItem[];
}
