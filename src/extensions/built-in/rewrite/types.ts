import type { MessageRole } from '../../../types';

export interface RewriteField {
  id: string; // e.g., 'character.description' or 'world_info.entry.content'
  label: string; // e.g., 'Description'
  value: string;
}

export interface FieldChange {
  fieldId: string;
  label: string;
  oldValue: string;
  newValue: string;
}

export interface RewriteLLMResponse {
  justification?: string;
  response?: string; // For single-field and backwards compatibility
  changes?: Omit<FieldChange, 'oldValue' | 'label'>[]; // For multi-field proposals from LLM
  toolCalls?: {
    name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    arguments: Record<string, any>;
  }[];
}

export interface RewriteSessionMessage {
  id: string;
  role: MessageRole;
  content: string | RewriteLLMResponse;
  timestamp: number;
  isToolResult?: boolean;
}

export interface RewriteSession {
  id: string;
  templateId: string;
  identifier: string;
  createdAt: number;
  updatedAt: number;
  initialFields: RewriteField[];
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

export type StructuredResponseFormat = 'native' | 'json' | 'xml' | 'text';

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
  isCharacterContextCollapsed?: boolean;
  isWorldInfoContextCollapsed?: boolean;
}

export interface RewriteSettings {
  templates: RewriteTemplate[];
  defaultConnectionProfile: string;

  // Map of Identifier (e.g. 'chat.input') -> Template ID
  lastUsedTemplates: Record<string, string>;

  // Map of Template ID -> Override settings
  templateOverrides: Record<string, RewriteTemplateOverride>;

  // Disabled tools for rewrite sessions
  disabledTools: string[];
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

const fixGrammarPreamble = `You are an expert editor assisting a user. Your task is to correct grammar, spelling, and punctuation while maintaining the original tone and style.

Your justification should be friendly and conversational. Be direct and focus on the corrections you've made. Vary your responses and do not start every message the same way. Do not repeat the user's request back to them.

Initial text is provided in the context.

{{#if contextMessages}}
[Context Info]
{{contextMessages}}
{{/if}}

${INPUT_TEXT_BLOCK}`;

const characterPolisherPreamble = `You are an expert character writer assisting a user. Your task is to refine specific fields of a Character Card (V2 spec) to be more evocative, show-don't-tell, and consistent with the character definition.

Your justification should be friendly and conversational. Be direct and focus on the enhancements you've made. Vary your responses and do not start every message the same way. Do not repeat the user's request back to them.

Use common everyday words. Avoid technical vocabulary and rare words. Under no circumstances, even logical ones, should {{char}} use ANY scientific, clinical, overly professional, official, academic, robotic or bureaucratic speech. It makes characters sound like robots, ruining immersion. Examples of BAD speech: "the protocol dictates..."; "Fascinating! Cardiovascular systems elongated!"; "Section twelve-point-four requires your signature...", etc.

Initial character state is provided in the context.

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
{{/if}}
{{#if availableFields}}
You are in a multi-field editing session. You can propose changes to one or more of the following fields.
Available field IDs for your response: {{availableFields}}
When proposing changes, use the 'changes' array in your response, with each object containing 'fieldId' and 'newValue'.
{{/if}}`;

const worldInfoRefinerPreamble = `You are an expert world builder and database manager assisting a user. Your task is to refine a World Info entry for clarity, conciseness, and effective key utilization.

Your justification should be friendly and conversational. Be direct and focus on the structural or content improvements you've made. Vary your responses and do not start every message the same way. Do not repeat the user's request back to them.

Initial entry state is provided in the context.

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

const genericPreamble = `You are a versatile writing assistant helping a user. Your task is to rewrite text based on specific instructions provided by the user.

Your justification should be friendly and conversational. Be direct and focus on how you've applied the instructions. Vary your responses and do not start every message the same way. Do not repeat the user's request back to them.

Initial text is provided in the context.

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

const summarizePreamble = `You are a professional summarization assistant. Your task is to condense chat history or text into its key points while preserving essential context and nuances.

Your justification should be friendly and conversational. Be direct and explain what was focused on in the summary. Vary your responses and do not start every message the same way. Do not repeat the user's request back to them.

Context to summarize is provided below.

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
