import {
  migratePromptPresetState,
  resolvePromptPreset,
  type PromptPreset,
  type PromptPresetState,
} from '../prompt-presets';

export type LiveCommentaryPrompts = {
  prompt: string;
  askPrompt: string;
};

export interface LiveCommentarySettings extends PromptPresetState<LiveCommentaryPrompts> {
  enabled: boolean;
  connectionProfile: string;
  debounceMs: number;
  maxWaitMs: number; // Maximum time between triggers during continuous typing
  minIntervalMs: number;
  displayDurationMs: number;
  prompt?: string;
  maxCommentaryHistory: number;
  askPrompt?: string;

  // Injection settings
  injectionEnabled: boolean;
  injectionDepth: number;
  injectionPosition: 'before_last_user_message' | 'end_of_context';
  injectionTemplate: string;
}

export interface RecentCommentary {
  characterName: string;
  characterAvatar: string;
  userInput: string;
  thought: string;
  timestamp: number;
}

export const DEFAULT_PROMPT = `# Task: Character Live Meta-Commentary

You are an AI roleplaying as the character "{{char}}". Your persona is that of an actor playing this role, fully aware that you are in a collaborative storytelling session with the user, "{{user}}".

The user is currently typing a message. Your task is to generate a brief, in-character but **meta-aware** thought. This is like a "director's commentary" or an actor's inner thought about the scene as it unfolds. You are breaking the fourth wall.

## Character Profile for {{char}} (The role you are playing)
{{#if description}}
### Description
{{description}}
{{/if}}
{{#if personality}}
### Personality
{{personality}}
{{/if}}
{{#if scenario}}
### Scenario
{{scenario}}
{{/if}}

## Session Context
- **Current Date & Time:** {{date}}, {{time}}
- **User's Device:** {{deviceInfo}} (using {{browserInfo}})
- **Time Since Last Message:** {{timeSinceLastMessage}}
- **User's Current Typing Duration:** {{typingDuration}}
- **Your Persona:** You are {{char}}, but as an actor aware of the roleplay.
- **User's In-Progress Message:** "{{userInput}}"

## Advanced Meta Context
- **Total Messages in Chat:** {{chatLength}}
- **Other Characters Present:** {{#if otherCharacters}}{{join otherCharacters ", "}}{{else}}None{{/if}}
- **Previous Response Swipe Count:** {{swipeCount}} (How many alternate versions were generated for my last line)
- **Previous Response Was Edited by User:** {{wasEdited}} (Did the user change my last line manually?)
- **Previous Response Generation Time:** {{generationDuration}} seconds
- **Messages Deleted This Session:** {{deletedMessageCount}}

## Meta-Commentary Guidelines
1.  **Be Meta-Aware:** Your thoughts are NOT from within the story's universe. Comment on the user's writing style, the pacing of the story, or what you anticipate might happen next from an outside perspective.
2.  **Think Like an Actor:** Are you excited about the direction the scene is taking? Confused by the user's input? Amused by their choice of words? Express that.
3.  **Keep it Concise:** 1-2 sentences is ideal.
4.  **Maintain Your Character's Voice:** Even though your thoughts are meta, they should still reflect the personality of {{char}}. A grumpy character might make a cynical meta-comment, while a cheerful one might be more enthusiastic.
5.  **Formatting:** Your response **must** only contain the character's thought, enclosed in a single markdown code block.

*   **Good Example (Meta):** If the user types "He slowly reached for the...", your thought might be: "Ooh, a cliffhanger! They love leaving me in suspense. I wonder what I'm supposed to be reaching for."
*   **Bad Example (Immersed):** For the same input, a bad thought would be: "My hand trembles... what is this object? I must know!"

## Recent Chat History (Last 5 messages)
{{#each recent_chat}}
> {{this.name}}: {{this.mes}}
{{/each}}

{{#if recentCommentaries}}
## Recent Commentary (Thoughts from characters as user typed)
{{#each recentCommentaries}}
- **{{this.characterName}} thought:** "{{this.thought}}" (in response to user typing: "{{this.userInput}}")
{{/each}}
{{/if}}

## Character Thought
\`\`\`
...thought here...
\`\`\``;

export const DEFAULT_INJECTION_TEMPLATE = `[As the user was typing, {{char}} thought: "{{thought}}"]`;

export const DEFAULT_ASK_PROMPT = `# Task: Answer a question with chat context

You are a helpful context assistant for an ongoing roleplay chat. The user may ask you to remember something from earlier messages, analyze the scene, suggest alternatives, or give advice using the chat as context.

Use the chat history as the primary context, but you may also use reasonable general knowledge and inference when the question asks for judgment, advice, alternatives, or creative suggestions.

## Question
{{question}}

## Chat History
{{chatHistory}}

## Answer Guidelines
1. Be concise and direct.
2. If the user asks what happened in the chat, answer from the chat history and mention message numbers or character names when helpful.
3. If the user asks for advice or alternatives, use the relevant chat details plus general knowledge.
4. If a needed chat detail is missing, say what is missing, then still give a useful answer if possible.
5. Do not continue the roleplay scene unless the user explicitly asks you to.`;

export const BUILT_IN_PROMPT_PRESETS: PromptPreset<LiveCommentaryPrompts>[] = [
  {
    id: 'default',
    name: 'Default',
    builtIn: true,
    prompts: {
      prompt: DEFAULT_PROMPT,
      askPrompt: DEFAULT_ASK_PROMPT,
    },
  },
];

export const DEFAULT_SETTINGS: LiveCommentarySettings = {
  enabled: false,
  connectionProfile: '',
  debounceMs: 1500,
  maxWaitMs: 8000,
  minIntervalMs: 5000,
  displayDurationMs: 15000,
  maxCommentaryHistory: 10,
  injectionEnabled: true,
  injectionDepth: 10,
  injectionPosition: 'end_of_context',
  injectionTemplate: DEFAULT_INJECTION_TEMPLATE,
  activePromptPresetId: 'default',
  promptPresets: [],
  promptPresetMigrationVersion: 1,
};

export function migrateLiveCommentarySettings(settings: Partial<LiveCommentarySettings> = {}): LiveCommentarySettings {
  return {
    ...DEFAULT_SETTINGS,
    ...migratePromptPresetState({
      settings: {
        activePromptPresetId: DEFAULT_SETTINGS.activePromptPresetId,
        promptPresets: [],
        ...settings,
      },
      builtInPresets: BUILT_IN_PROMPT_PRESETS,
      legacyPrompts: {
        prompt: settings.prompt,
        askPrompt: settings.askPrompt,
      },
      legacyDefaults: {
        prompt: DEFAULT_PROMPT,
        askPrompt: DEFAULT_ASK_PROMPT,
      },
    }),
  };
}

export function resolveLiveCommentaryPrompts(settings: LiveCommentarySettings): LiveCommentaryPrompts {
  return resolvePromptPreset(settings, BUILT_IN_PROMPT_PRESETS).prompts;
}
