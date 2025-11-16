import type { Prompt, PromptOrderConfig, SamplerSettings } from './types';

export enum SendOnEnterOptions {
  DISABLED = -1,
  AUTO = 0,
  ENABLED = 1,
}

export enum DebounceTimeout {
  QUICK = 100,
  SHORT = 200,
  STANDARD = 300,
  RELAXED = 1000,
  EXTENDED = 5000,
}

export enum TagImportSetting {
  NONE = 'none',
  ALL = 'all',
  ONLY_EXISTING = 'only_existing',
  ASK = 'ask',
}

export const DEFAULT_SAVE_EDIT_TIMEOUT = DebounceTimeout.RELAXED;
export const DEFAULT_PRINT_TIMEOUT = DebounceTimeout.QUICK;
export const default_avatar = 'img/ai4.png';
export const default_user_avatar = 'img/user-default.png';
export const ANIMATION_DURATION_DEFAULT = 125;
export const talkativeness_default = 0.5;
export const depth_prompt_depth_default = 4;
export const depth_prompt_role_default = 'system';

export const defaultPrompts: Prompt[] = [
  {
    name: 'Main Prompt',
    system_prompt: true,
    role: 'system',
    content: "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.",
    identifier: 'main',
  },
  { name: 'Post-History Instructions', system_prompt: true, role: 'system', content: '', identifier: 'jailbreak' },
  { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
  { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
  { identifier: 'charPersonality', name: 'Char Personality', system_prompt: true, marker: true },
  { identifier: 'scenario', name: 'Scenario', system_prompt: true, marker: true },
  { identifier: 'dialogueExamples', name: 'Chat Examples', system_prompt: true, marker: true },
  { identifier: 'worldInfoAfter', name: 'World Info (after)', system_prompt: true, marker: true },
  { identifier: 'worldInfoBefore', name: 'World Info (before)', system_prompt: true, marker: true },
];

export const defaultPromptOrder: PromptOrderConfig = {
  order: [
    { identifier: 'main', enabled: true },
    { identifier: 'charDescription', enabled: true },
    { identifier: 'charPersonality', enabled: true },
    { identifier: 'scenario', enabled: true },
    { identifier: 'dialogueExamples', enabled: true },
    { identifier: 'worldInfoBefore', enabled: true },
    { identifier: 'chatHistory', enabled: true },
    { identifier: 'worldInfoAfter', enabled: true },
    { identifier: 'jailbreak', enabled: true },
  ],
};

export const defaultSamplerSettings: SamplerSettings = {
  temperature: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
  top_p: 1,
  top_k: 0,
  top_a: 0,
  min_p: 0,
  max_context: 4096,
  max_context_unlocked: false,
  max_tokens: 500,
  stream: true,
  prompts: defaultPrompts,
  prompt_order: defaultPromptOrder,
};
