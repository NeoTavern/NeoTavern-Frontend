import {
  migratePromptPresetState,
  resolvePromptPreset,
  type PromptPreset,
  type PromptPresetState,
} from '../prompt-presets';

export interface ChatMemoryRecord {
  bookName: string;
  entryUid: number;
  range: [number, number];
  timestamp: number;
}

export interface ChatMemoryMetadata {
  'core.chat-memory'?: {
    memories: ChatMemoryRecord[];
    targetLorebook?: string;
    lorebookRange?: [number, number];
    summaryRange?: [number, number];
    activeTab?: string;
  };
}

export interface MemoryMessageExtra {
  'core.chat-memory'?: {
    summarized?: boolean; // Used by Lorebook summary to mark hidden messages
    original_is_system?: boolean;
    summary?: string; // Per-message summary
  };
}

export type ChatMemoryPrompts = {
  prompt: string;
  messageSummaryPrompt: string;
};

export interface ExtensionSettings extends PromptPresetState<ChatMemoryPrompts> {
  connectionProfile: string;
  prompt?: string; // Legacy lorebook summary prompt
  autoHideMessages: boolean;

  // Message Summary Settings
  enableMessageSummarization: boolean;
  autoMessageSummarize: boolean;
  messageSummaryPrompt?: string;
  ignoreSummaryCount: number;
}

export const EXTENSION_KEY = 'core.chat-memory';

export const DEFAULT_PROMPT = `# Task: Summarize Conversation

You are an expert editor. Your task is to summarize the provided conversation segment concisely.
Focus on key events, decisions, and facts that should be remembered for the future.

## Text to Summarize
\`\`\`
{{text}}
\`\`\`

## Instructions
1. Summarize the text.
2. Your response **must** only contain the summary, enclosed in a single markdown code block.

Example format:
\`\`\`
The user and the character met at the tavern. They discussed...
\`\`\``;

export const DEFAULT_MESSAGE_SUMMARY_PROMPT = `# Task: Summarize Message

Summarize the following message in one concise sentence. Capture the core meaning and any actions taken.

## Message
\`\`\`
{{text}}
\`\`\`

## Instructions
1. Your response **must** only contain the summary, enclosed in a single markdown code block.

Example format:
\`\`\`
He agreed to the terms and shook hands.
\`\`\``;

export const BUILT_IN_PROMPT_PRESETS: PromptPreset<ChatMemoryPrompts>[] = [
  {
    id: 'default',
    name: 'Default',
    builtIn: true,
    prompts: {
      prompt: DEFAULT_PROMPT,
      messageSummaryPrompt: DEFAULT_MESSAGE_SUMMARY_PROMPT,
    },
  },
];

export const DEFAULT_SETTINGS: ExtensionSettings = {
  connectionProfile: '',
  autoHideMessages: true,
  enableMessageSummarization: false,
  autoMessageSummarize: false,
  ignoreSummaryCount: 100,
  activePromptPresetId: 'default',
  promptPresets: [],
  promptPresetMigrationVersion: 1,
};

export function migrateChatMemorySettings(settings: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...migratePromptPresetState({
      settings: { ...DEFAULT_SETTINGS, ...settings },
      builtInPresets: BUILT_IN_PROMPT_PRESETS,
      legacyPrompts: {
        prompt: settings.prompt,
        messageSummaryPrompt: settings.messageSummaryPrompt,
      },
      legacyDefaults: {
        prompt: DEFAULT_PROMPT,
        messageSummaryPrompt: DEFAULT_MESSAGE_SUMMARY_PROMPT,
      },
    }),
  };
}

export function resolveChatMemoryPrompts(settings: ExtensionSettings): ChatMemoryPrompts {
  return resolvePromptPreset(settings, BUILT_IN_PROMPT_PRESETS).prompts;
}
