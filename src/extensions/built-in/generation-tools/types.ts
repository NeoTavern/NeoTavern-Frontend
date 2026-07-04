import {
  migratePromptPresetState,
  resolvePromptPreset,
  type PromptPreset,
  type PromptPresetState,
} from '../prompt-presets';

export interface RerollSnapshot {
  messageIndex: number;
  contentBefore: string;
  swipeId: number;
}

export type GenerationToolsPrompts = {
  impersonatePrompt: string;
  generatePrompt: string;
};

export interface ExtensionSettings extends PromptPresetState<GenerationToolsPrompts> {
  rerollContinueEnabled: boolean;
  deleteContinueEnabled: boolean;
  swipeEnabled: boolean;
  impersonateEnabled: boolean;
  impersonateConnectionProfile: string;
  impersonatePrompt?: string;
  generateEnabled: boolean;
  generatePrompt?: string;
}

export const DEFAULT_IMPERSONATE_PROMPT = `Your task this time is to write your response as if you were {{user}}, impersonating their style. Use {{user}}'s dialogue and actions so far as a guideline for how they would likely act. Don't ever write as {{char}}. Only talk and act as {{user}}.

Maintain consistent formatting (quotes, asterisks, etc.) with chat history.`;

export const DEFAULT_GENERATE_PROMPT = `[Generate the next message in the conversation. Your response should follow logically from the existing conversation, guided by this final user instruction.]

Instructions: {{input}}`;

export const BUILT_IN_PROMPT_PRESETS: PromptPreset<GenerationToolsPrompts>[] = [
  {
    id: 'default',
    name: 'Default',
    builtIn: true,
    prompts: {
      impersonatePrompt: DEFAULT_IMPERSONATE_PROMPT,
      generatePrompt: DEFAULT_GENERATE_PROMPT,
    },
  },
];

export const DEFAULT_SETTINGS: ExtensionSettings = {
  rerollContinueEnabled: true,
  deleteContinueEnabled: true,
  swipeEnabled: true,
  impersonateEnabled: true,
  impersonateConnectionProfile: '',
  generateEnabled: true,
  activePromptPresetId: 'default',
  promptPresets: [],
  promptPresetMigrationVersion: 1,
};

export function migrateGenerationToolsSettings(settings: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...migratePromptPresetState({
      settings: { ...DEFAULT_SETTINGS, ...settings },
      builtInPresets: BUILT_IN_PROMPT_PRESETS,
      legacyPrompts: {
        impersonatePrompt: settings.impersonatePrompt,
        generatePrompt: settings.generatePrompt,
      },
      legacyDefaults: {
        impersonatePrompt: DEFAULT_IMPERSONATE_PROMPT,
        generatePrompt: DEFAULT_GENERATE_PROMPT,
      },
    }),
  };
}

export function resolveGenerationToolsPrompts(settings: ExtensionSettings): GenerationToolsPrompts {
  return resolvePromptPreset(settings, BUILT_IN_PROMPT_PRESETS).prompts;
}
