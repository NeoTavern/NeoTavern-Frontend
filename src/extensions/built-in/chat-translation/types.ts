export enum AutoTranslateMode {
  NONE = 'none',
  RESPONSES = 'responses',
  INPUTS = 'inputs',
  BOTH = 'both',
}

export interface ChatTranslationSettings {
  connectionProfile: string;
  sourceLang: string;
  targetLang: string;
  autoMode: AutoTranslateMode;
  prompt: string;
}

export const DEFAULT_PROMPT = `# Task: Translate Text

You are an expert multilingual translator. Your task is to translate the user's text into {{targetLang}} accurately, preserving the original markdown formatting.

## Context: Previous Messages
{{#each (slice chat -3)}}
**Message {{add @index 1}}:**
> {{this.name}}: {{this.mes}}

{{/each}}

## Perspective
{{name}}

## Text to Translate
\`\`\`
{{prompt}}
\`\`\`

## Instructions
1.  Translate the "Text to Translate" into **{{targetLang}}**.
2.  Preserve all markdown formatting (headings, lists, bold, etc.).
3.  Your response **must** only contain the translated text, enclosed in a single markdown code block.

Important: Your response must follow this exact format with the translation enclosed in code blocks (\`\`\`).`;
