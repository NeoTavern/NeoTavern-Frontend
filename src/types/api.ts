import { CustomPromptPostProcessing } from '../constants';
import type { I18nKey } from './i18n';
import type { ApiFormatter, SettingsPath } from './settings';

export const api_providers = {
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
  KOBOLDCPP: 'koboldcpp',
  OLLAMA: 'ollama',
} as const;

export type ApiProvider = (typeof api_providers)[keyof typeof api_providers];

export interface ConnectionProfile {
  id: string;
  name: string;
  provider?: ApiProvider;
  model?: string;
  sampler?: string;
  formatter?: ApiFormatter;
  instructTemplate?: string;
  customPromptPostProcessing?: CustomPromptPostProcessing;
}

export interface ApiModel {
  id: string;
  name?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface AiConfigCondition {
  provider?: ApiProvider | ApiProvider[];
  formatter?: ApiFormatter | ApiFormatter[];
}

/**
 * Base properties shared by all configuration items
 */
interface AiConfigBase {
  apiId?: string; // For preset manager to know which API it controls
  label?: I18nKey;
  description?: I18nKey;
  infoTooltip?: I18nKey;
  infoLink?: string;
  conditions?: AiConfigCondition | AiConfigCondition[];
  cssClass?: string;
}

/**
 * Widgets that bind directly to a specific setting path.
 * The `id` MUST be a valid `SettingsPath`.
 */
export interface AiConfigValueItem extends AiConfigBase {
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
    | 'draggable-list';
  id?: SettingsPath;

  // Specific props for value widgets
  min?: number;
  max?: number;
  step?: number;
  maxUnlockedId?: SettingsPath;
  unlockLabel?: I18nKey;
  unlockTooltip?: I18nKey;
  options?: { value: string | number; label: I18nKey | string }[];
  placeholder?: string;

  /**
   * explicit type definition for how the data is stored in the store.
   * If 'array', the widget will handle joining/splitting the value.
   */
  valueType?: 'array' | 'string' | 'number' | 'boolean';
  /**
   * If valueType is 'array', this separator is used to join/split the string for the UI.
   * Defaults to ',' if not specified.
   * Common values: '\n' for textareas, ',' for text inputs.
   */
  arraySeparator?: string;

  /**
   * For widget='key-manager', specifies the SECRET_KEY constant key (e.g. 'api_key_openai')
   */
  secretKey?: string;
}

/**
 * Widgets that are purely structural or informational.
 * The `id` can be any string (used for keys, DOM IDs, or toggling groups).
 */
export interface AiConfigStructuralItem extends AiConfigBase {
  widget: 'group' | 'custom-component' | 'info-display' | 'prompt-manager-button' | 'hr' | 'header';
  id?: string;

  // Group specific
  items?: AiConfigItem[];
  enableable?: boolean;

  // Custom component specific
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: any;

  // Info display specific
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  valueGetter?: (apiStore: any) => string;
}

/**
 * Discriminant union of all config item types.
 * This ensures that if widget is 'slider', id MUST be SettingsPath,
 * but if widget is 'group', id can be a plain string.
 */
export type AiConfigItem = AiConfigValueItem | AiConfigStructuralItem;

export interface AiConfigSection {
  id: string;
  conditions?: AiConfigCondition | AiConfigCondition[];
  items: AiConfigItem[];
}
