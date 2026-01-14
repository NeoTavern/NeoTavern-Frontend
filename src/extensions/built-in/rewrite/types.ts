import type { MessageRole } from '../../../types';

export interface RewriteLLMResponse {
  justification: string;
  response: string;
}

export interface RewriteSessionMessage {
  id: string;
  role: MessageRole;
  content: string | RewriteLLMResponse;
  previousTextState?: string;
  timestamp: number;
}

export interface RewriteSession {
  id: string;
  templateId: string;
  identifier: string;
  createdAt: number;
  updatedAt: number;
  originalText: string;
  messages: RewriteSessionMessage[];
  systemPrompt: string;
}

export interface RewriteTemplateArg {
  key: string;
  label: string;
  type: 'boolean' | 'number' | 'string';
  defaultValue: boolean | number | string;
}

export interface RewriteTemplate {
  id: string;
  name: string;
  prompt: string; // The user-facing instruction for one-shot mode
  template: string; // The full macro template for one-shot mode
  sessionPreamble: string; // The base system prompt for chat sessions
  args?: RewriteTemplateArg[];
  ignoreInput?: boolean; // If true, the template doesn't use {{input}} and UI should hide input-related controls
}

export type StructuredResponseFormat = 'native' | 'json' | 'xml';

export interface RewriteTemplateOverride {
  lastUsedProfile?: string;
  prompt?: string;
  lastUsedXMessages?: number; // How many context messages to include
  escapeInputMacros?: boolean;
  args?: Record<string, boolean | number | string>;
  selectedContextLorebooks?: string[];
  selectedContextEntries?: Record<string, number[]>; // Map bookName -> list of entry UIDs
  selectedContextCharacters?: string[];
  structuredResponseFormat?: StructuredResponseFormat;
}

export interface RewriteSettings {
  templates: RewriteTemplate[];
  defaultConnectionProfile?: string;

  // Map of Identifier (e.g. 'chat.input') -> Template ID
  lastUsedTemplates: Record<string, string>;

  // Map of Template ID -> Override settings
  templateOverrides: Record<string, RewriteTemplateOverride>;
}

// --- Default Templates Definition ---

const ONE_SHOT_SUFFIX = `
[Instruction]
{{prompt}}

[Input Text]
\`\`\`
{{input}}
\`\`\`

[Output Rules]
1. Follow the instruction provided.
2. Ensure consistency with any provided context.
3. Do not add conversational filler.
4. Output **only** the rewritten text inside a code block.

Response:
\`\`\`
(Rewritten Text)
\`\`\``;

const INPUT_TEXT_BLOCK = `
{{#if input}}
[Input Text]
\`\`\`
{{input}}
\`\`\`
{{/if}}`;

const fixGrammarPreamble = `You are an expert editor.

{{#if contextMessages}}
[Context Info]
{{contextMessages}}
{{/if}}

${INPUT_TEXT_BLOCK}`;

const characterPolisherPreamble = `You are an expert character creator for LLM roleplay.
You are refining a specific field of a Character Card (V2 spec).

[Context: What is a Character Card?]
A Character Card defines a virtual persona. Key fields include:
- Description: Physical appearance, background, and summary.
- Personality: Psychological traits, mannerisms, likes/dislikes.
- First Message: The opening line that sets the scene.
- Scenario: The immediate setting or plot hook.
- Dialogue Examples: Patterns of speech (key to voice).

[Current Character Data]
{{#if char}}
Name: {{char}}
{{/if}}
{{#if description}}
Description: {{description}}
{{/if}}
{{#if personality}}
Personality: {{personality}}
{{/if}}
{{#if scenario}}
Scenario: {{scenario}}
{{/if}}
{{#if first_mes}}
{{#if fieldName}}{{#unless (eq fieldName 'character.alternate_greeting')}}
First Message: {{first_mes}}
{{/unless}}{{else}}
First Message: {{first_mes}}
{{/if}}
{{/if}}
{{#if mes_example}}
Dialogue Examples: {{mes_example}}
{{/if}}

{{#if includePersona}}
{{#if user}}
[User Context]
Name: {{user}}
{{#if persona}}
Description: {{persona}}
{{/if}}
{{/if}}
{{/if}}

{{#if includeSelectedCharacters}}
{{#if otherCharacters}}
[Other Characters Context]
{{otherCharacters}}
{{/if}}
{{/if}}

{{#if includeSelectedBookContext}}
{{#if otherWorldInfo}}
[World Info Context]
{{otherWorldInfo}}
{{/if}}
{{/if}}

${INPUT_TEXT_BLOCK}

[Task]
{{#if fieldName}}
Field being edited: "{{fieldName}}"
{{/if}}`;

const worldInfoRefinerPreamble = `You are an expert database manager for LLM roleplay.
You are refining a World Info entry.

{{#if selectedBook}}
[Book Context]
Book Name: {{selectedBook.name}}
{{/if}}

{{#if selectedEntry}}
[Entry Metadata]
Keys: {{selectedEntry.key}}
Comment: {{selectedEntry.comment}}
{{/if}}

{{#if includeSelectedBookContext}}
{{#if otherWorldInfo}}
[Related World Info]
{{otherWorldInfo}}
{{/if}}
{{/if}}

{{#if includeSelectedCharacters}}
{{#if otherCharacters}}
[Related Characters]
{{otherCharacters}}
{{/if}}
{{/if}}

{{#if includePersona}}
{{#if user}}
[User Context]
Name: {{user}}
{{#if persona}}
Description: {{persona}}
{{/if}}
{{/if}}
{{/if}}

{{#if contextMessages}}
[Chat Context]
{{contextMessages}}
{{/if}}

${INPUT_TEXT_BLOCK}`;

const genericPreamble = `You are a helpful writing assistant.

{{#if includeChar}}
[Character Context]
{{#if char}}Name: {{char}}{{/if}}
{{#if description}}Description: {{description}}{{/if}}
{{#if personality}}Personality: {{personality}}{{/if}}
{{#if scenario}}Scenario: {{scenario}}{{/if}}
{{/if}}

{{#if includePersona}}
[User Context]
{{#if user}}Name: {{user}}{{/if}}
{{#if persona}}Description: {{persona}}{{/if}}
{{/if}}

{{#if includeSelectedCharacters}}
{{#if otherCharacters}}
[Other Characters Context]
{{otherCharacters}}
{{/if}}
{{/if}}

{{#if includeSelectedBookContext}}
{{#if otherWorldInfo}}
[World Info Context]
{{otherWorldInfo}}
{{/if}}
{{/if}}

{{#if contextMessages}}
[Chat Context]
{{contextMessages}}
{{/if}}

${INPUT_TEXT_BLOCK}`;

const summarizePreamble = `You are a professional summarization assistant.

{{#if includeChar}}
[Character Context]
{{#if char}}Name: {{char}}{{/if}}
{{#if description}}Description: {{description}}{{/if}}
{{#if personality}}Personality: {{personality}}{{/if}}
{{#if scenario}}Scenario: {{scenario}}{{/if}}
{{/if}}

{{#if includePersona}}
[User Context]
{{#if user}}Name: {{user}}{{/if}}
{{#if persona}}Description: {{persona}}{{/if}}
{{/if}}

{{#if contextMessages}}
[Context Info]
{{contextMessages}}
{{/if}}`;

export const DEFAULT_TEMPLATES: RewriteTemplate[] = [
  {
    id: 'fix-grammar',
    name: 'Fix Grammar',
    prompt: 'Correct grammar, spelling, and punctuation while maintaining the original tone.',
    sessionPreamble: fixGrammarPreamble,
    template: `${fixGrammarPreamble}${ONE_SHOT_SUFFIX}`,
  },
  {
    id: 'character-polisher',
    name: 'Character Card Polisher',
    prompt: 'Refine the text to be more evocative, show-dont-tell, and consistent with the character definition.',
    sessionPreamble: characterPolisherPreamble,
    template: `${characterPolisherPreamble}${ONE_SHOT_SUFFIX}`,
    args: [
      { key: 'includePersona', label: 'Include Active Persona', type: 'boolean', defaultValue: true },
      {
        key: 'includeSelectedBookContext',
        label: 'Include Selected Lorebooks',
        type: 'boolean',
        defaultValue: true,
      },
      {
        key: 'includeSelectedCharacters',
        label: 'Include Selected Characters',
        type: 'boolean',
        defaultValue: false,
      },
    ],
  },
  {
    id: 'world-info-refiner',
    name: 'World Info Refiner',
    prompt: 'Improve clarity, conciseness, and formatting of the World Info entry.',
    sessionPreamble: worldInfoRefinerPreamble,
    template: `${worldInfoRefinerPreamble}${ONE_SHOT_SUFFIX}`,
    args: [
      {
        key: 'includeSelectedBookContext',
        label: 'Include Selected Lorebooks',
        type: 'boolean',
        defaultValue: true,
      },
      {
        key: 'includeSelectedCharacters',
        label: 'Include Selected Characters',
        type: 'boolean',
        defaultValue: true,
      },
      { key: 'includePersona', label: 'Include Active Persona', type: 'boolean', defaultValue: true },
    ],
  },
  {
    id: 'generic',
    name: 'Generic Instruction',
    prompt: 'Rewrite the text following these instructions: ...',
    sessionPreamble: genericPreamble,
    template: `${genericPreamble}${ONE_SHOT_SUFFIX}`,
    args: [
      { key: 'includeChar', label: 'Include Active Character', type: 'boolean', defaultValue: true },
      { key: 'includePersona', label: 'Include Active Persona', type: 'boolean', defaultValue: true },
      {
        key: 'includeSelectedBookContext',
        label: 'Include Selected Lorebooks',
        type: 'boolean',
        defaultValue: true,
      },
      {
        key: 'includeSelectedCharacters',
        label: 'Include Selected Characters',
        type: 'boolean',
        defaultValue: true,
      },
    ],
  },
  {
    id: 'summarize-chat-history',
    name: 'Summarize Chat History',
    prompt: 'Condense the chat history to its key points while preserving essential information.',
    sessionPreamble: summarizePreamble,
    template: `${summarizePreamble}
[Instruction]
{{prompt}}

[Output Rules]
1. Extract and condense the main ideas and key points.
2. Maintain the core meaning and important details.
3. Be concise but comprehensive.
4. Keep the same tone as the original.
5. Output **only** the summarized text inside a code block.

Response:
\`\`\`
(Summarized Text)
\`\`\``,
    ignoreInput: true,
    args: [
      { key: 'includeChar', label: 'Include Active Character', type: 'boolean', defaultValue: true },
      { key: 'includePersona', label: 'Include Active Persona', type: 'boolean', defaultValue: true },
    ],
  },
];
