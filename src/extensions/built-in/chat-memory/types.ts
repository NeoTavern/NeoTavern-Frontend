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

export interface ExtensionSettings {
  connectionProfile?: string;
  prompt: string; // Lorebook summary prompt
  autoHideMessages: boolean;

  // Message Summary Settings
  enableMessageSummarization: boolean;
  autoMessageSummarize: boolean;
  messageSummaryPrompt: string;
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
