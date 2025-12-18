export interface RewriteTemplate {
  id: string;
  name: string;
  prompt: string; // The instruction
  template: string; // The macro template
}

export interface RewriteTemplateOverride {
  lastUsedProfile?: string;
  prompt?: string;
  lastUsedXMessages?: number; // How many context messages to include
  escapeInputMacros?: boolean;
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
    template: `You are a helpful writing assistant.

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
1. Follow the instruction provided above.
2. Output **only** the rewritten text inside a code block.
3. Do not add conversational filler.

Response:
\`\`\`
(Rewritten Text)
\`\`\``,
  },
];
