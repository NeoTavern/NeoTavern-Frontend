export interface MemoryExtensionData {
  chatId: string;
  range: [number, number];
  timestamp: number;
}

export interface MemoryMessageExtra {
  summarized: boolean;
  original_is_system?: boolean;
}

export interface ExtensionSettings {
  connectionProfile?: string;
  prompt: string;
  autoHideMessages: boolean;
  lastLorebook?: string;
}

export const EXTENSION_KEY = 'core.chat-memory';

export const DEFAULT_PROMPT = `Summarize the following conversation segment concisely. Focus on key events, decisions, and facts that should be remembered for the future.

Conversation:
{{text}}

Summary:`;
