export interface RerollSnapshot {
  messageIndex: number;
  contentBefore: string;
  swipeId: number;
}

export interface ExtensionSettings {
  rerollContinueEnabled: boolean;
  swipeEnabled: boolean;
  impersonateEnabled: boolean;
  impersonateConnectionProfile?: string;
  impersonatePrompt: string;
  generateEnabled: boolean;
  generatePrompt: string;
}

export const DEFAULT_IMPERSONATE_PROMPT = `Your task this time is to write your response as if you were {{user}}, impersonating their style. Use {{user}}'s dialogue and actions so far as a guideline for how they would likely act. Don't ever write as {{char}}. Only talk and act as {{user}}.

Remember to use asterisks for actions and quotes for dialogue, matching the style of previous messages.`;

export const DEFAULT_GENERATE_PROMPT = `[Generate the next message in the conversation. Your response should follow logically from the existing conversation, guided by this final user instruction.]

Instructions: {{input}}`;
