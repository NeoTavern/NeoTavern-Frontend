export interface RewriteTemplateArg {
  key: string;
  label: string;
  type: 'boolean' | 'number' | 'string';
  defaultValue: boolean | number | string;
}

export interface RewriteTemplate {
  id: string;
  name: string;
  prompt: string; // The instruction
  template: string; // The macro template
  args?: RewriteTemplateArg[];
  ignoreInput?: boolean; // If true, the template doesn't use {{input}} and UI should hide input-related controls
}

export interface RewriteTemplateOverride {
  lastUsedProfile?: string;
  prompt?: string;
  lastUsedXMessages?: number; // How many context messages to include
  escapeInputMacros?: boolean;
  args?: Record<string, boolean | number | string>;
}

export interface RewriteSettings {
  templates: RewriteTemplate[];
  defaultConnectionProfile?: string;

  // Map of Identifier (e.g. 'chat.input') -> Template ID
  lastUsedTemplates: Record<string, string>;

  // Map of Template ID -> Override settings
  templateOverrides: Record<string, RewriteTemplateOverride>;
}

export const DEFAULT_TEMPLATES: RewriteTemplate[] = [
  {
    id: 'fix-grammar',
    name: 'Fix Grammar',
    prompt: 'Correct grammar, spelling, and punctuation while maintaining the original tone.',
    template: `You are an expert editor.

{{#if contextMessages}}
[Context Info]
{{contextMessages}}
{{/if}}

[Instruction]
{{prompt}}

[Input Text]
\`\`\`
{{input}}
\`\`\`

[Output Rules]
1. Fix all grammar and spelling errors.
2. Ensure the tone matches the provided context (if any).
3. Do not add conversational filler.
4. Output **only** the corrected text inside a code block.

Response:
\`\`\`
(Corrected Text)
\`\`\``,
  },
  {
    id: 'character-polisher',
    name: 'Character Card Polisher',
    prompt: 'Refine the text to be more evocative, show-dont-tell, and consistent with the character definition.',
    template: `You are an expert character creator for LLM roleplay.
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
First Message: {{first_mes}}
{{/if}}
{{#if mes_example}}
Dialogue Examples: {{mes_example}}
{{/if}}

[Task]
{{#if fieldName}}
Field being edited: "{{fieldName}}"
{{/if}}
Instruction: {{prompt}}

[Input Text]
\`\`\`
{{input}}
\`\`\`

[Output Rules]
1. Enhance the writing style (show, don't tell).
2. Ensure consistency with the known Character Data.
3. Output **only** the new text inside a code block.

Response:
\`\`\`
(New Text)
\`\`\``,
  },
  {
    id: 'generic',
    name: 'Generic Instruction',
    prompt: 'Rewrite the text following these instructions: ...',
    args: [
      {
        key: 'includeChar',
        label: 'Include Active Character',
        type: 'boolean',
        defaultValue: true,
      },
      {
        key: 'includePersona',
        label: 'Include Active Persona',
        type: 'boolean',
        defaultValue: true,
      },
    ],
    template: `You are a helpful writing assistant.

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
[Chat Context]
{{contextMessages}}
{{/if}}

[Instruction]
{{prompt}}

[Input Text]
\`\`\`
{{input}}
\`\`\`

[Output Rules]
1. Follow the instruction provided above.
2. Output **only** the rewritten text inside a code block.
3. Do not add conversational filler.

Response:
\`\`\`
(Rewritten Text)
\`\`\``,
  },
  {
    id: 'summarize',
    name: 'Summarize',
    prompt: 'Condense the text to its key points while preserving essential information.',
    ignoreInput: true,
    args: [
      {
        key: 'includeChar',
        label: 'Include Active Character',
        type: 'boolean',
        defaultValue: true,
      },
      {
        key: 'includePersona',
        label: 'Include Active Persona',
        type: 'boolean',
        defaultValue: true,
      },
    ],
    template: `You are a professional summarization assistant.

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
{{/if}}

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
  },
];
