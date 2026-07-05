import {
  migratePromptPresetState,
  resolvePromptPreset,
  type PromptPreset,
  type PromptPresetState,
} from '../prompt-presets';

export enum GroupReplyStrategy {
  MANUAL = 0,
  NATURAL_ORDER = 1,
  LIST_ORDER = 2,
  POOLED_ORDER = 3,
  LLM_DECISION = 4,
}

export enum GroupGenerationHandlingMode {
  SWAP = 'swap',
  JOIN_EXCLUDE_MUTED = 'join_exclude',
  JOIN_INCLUDE_MUTED = 'join_include',
  SWAP_INCLUDE_SUMMARIES = 'swap_include_summaries',
}

export interface GroupMemberStatus {
  muted: boolean;
  summary?: string;
}

export interface GroupChatConfig {
  config: {
    replyStrategy: GroupReplyStrategy;
    handlingMode: GroupGenerationHandlingMode;
    allowSelfResponses: boolean;
    autoMode: number; // seconds, 0 = disabled
    decisionContextSize: number;
  };
  members: Record<string, GroupMemberStatus>;
}

export type GroupChatPrompts = {
  defaultDecisionPromptTemplate: string;
  defaultSummaryPromptTemplate: string;
  summaryInjectionTemplate: string;
};

export interface GroupExtensionSettings extends PromptPresetState<GroupChatPrompts> {
  defaultDecisionPromptTemplate: string;
  defaultSummaryPromptTemplate: string;
  summaryInjectionTemplate: string;
  defaultConnectionProfile: string;
}

export const DEFAULT_DECISION_TEMPLATE = `You are an AI assistant orchestrating a roleplay group chat.
Your task is to determine who should speak next based on the recent conversation context.

[Active Members]
{{memberNames}}
{{user}} (The User)

[Recent Conversation]
{{recentMessages}}

[Instructions]
1. Analyze the conversation flow to decide who should reply.
2. If it is {{user}}'s turn to speak, output "{{user}}".
3. If a character should speak, output their exact name.
4. Output only the name inside a code block. Do not output anything else.

Example Response:
\`\`\`
{{firstCharName}}
\`\`\``;

export const DEFAULT_SUMMARY_TEMPLATE = `Summarize the following character in 2-3 sentences. Focus on their personality and role to help other characters interact with them.

Name: {{name}}
Description: {{description}}
Personality: {{personality}}`;

export const DEFAULT_SUMMARY_INJECTION_TEMPLATE = `{{description}}

[Other Group Members]
{{summaries}}`;

export const BUILT_IN_PROMPT_PRESETS: PromptPreset<GroupChatPrompts>[] = [
  {
    id: 'default',
    name: 'Default',
    builtIn: true,
    prompts: {
      defaultDecisionPromptTemplate: DEFAULT_DECISION_TEMPLATE,
      defaultSummaryPromptTemplate: DEFAULT_SUMMARY_TEMPLATE,
      summaryInjectionTemplate: DEFAULT_SUMMARY_INJECTION_TEMPLATE,
    },
  },
];

export const DEFAULT_SETTINGS: GroupExtensionSettings = {
  defaultDecisionPromptTemplate: DEFAULT_DECISION_TEMPLATE,
  defaultSummaryPromptTemplate: DEFAULT_SUMMARY_TEMPLATE,
  summaryInjectionTemplate: DEFAULT_SUMMARY_INJECTION_TEMPLATE,
  defaultConnectionProfile: '',
  activePromptPresetId: 'default',
  promptPresets: [],
  promptPresetMigrationVersion: 1,
};

export function migrateGroupChatSettings(settings: Partial<GroupExtensionSettings> = {}): GroupExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    ...migratePromptPresetState({
      settings: {
        activePromptPresetId: DEFAULT_SETTINGS.activePromptPresetId,
        promptPresets: [],
        ...settings,
      },
      builtInPresets: BUILT_IN_PROMPT_PRESETS,
      legacyPrompts: {
        defaultDecisionPromptTemplate: settings.defaultDecisionPromptTemplate,
        defaultSummaryPromptTemplate: settings.defaultSummaryPromptTemplate,
        summaryInjectionTemplate: settings.summaryInjectionTemplate,
      },
      legacyDefaults: {
        defaultDecisionPromptTemplate: DEFAULT_DECISION_TEMPLATE,
        defaultSummaryPromptTemplate: DEFAULT_SUMMARY_TEMPLATE,
        summaryInjectionTemplate: DEFAULT_SUMMARY_INJECTION_TEMPLATE,
      },
    }),
  };
}

export function resolveGroupChatPrompts(settings: GroupExtensionSettings): GroupChatPrompts {
  return resolvePromptPreset(settings, BUILT_IN_PROMPT_PRESETS).prompts;
}
