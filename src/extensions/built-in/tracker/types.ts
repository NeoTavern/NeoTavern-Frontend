export interface TrackerSchemaPreset {
  name: string;
  schema: string; // JSON schema as a string
  template: string; // Handlebars HTML template as a string
}

export interface TrackerSettings {
  enabled: boolean;
  connectionProfile?: string;
  autoMode: 'none' | 'responses' | 'inputs' | 'both';
  promptEngineering: 'native' | 'json' | 'xml';
  schemaPresets: TrackerSchemaPreset[];
  activeSchemaPresetName: string;
  prompt: string;
  maxResponseTokens: number;
  includeLastXMessages: number;
  includeLastXTrackers: number;
}

export interface TrackerData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trackerJson: Record<string, any>;
  trackerHtml: string;
  schemaName: string;
  status: 'idle' | 'pending' | 'success' | 'error';
  error?: string;
}

export const DEFAULT_PRESETS: TrackerSchemaPreset[] = [
  {
    name: 'Character Sheet',
    schema: JSON.stringify(
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: "The character's name." },
          age: { type: 'integer', description: "The character's age." },
          class: { type: 'string', description: "The character's class (e.g., Warrior, Mage)." },
          hp: { type: 'integer', description: 'Current hit points.' },
          max_hp: { type: 'integer', description: 'Maximum hit points.' },
          short_summary: { type: 'string', description: 'A one-sentence summary of the character.' },
        },
        required: ['name', 'age', 'class', 'hp', 'max_hp', 'short_summary'],
      },
      null,
      2,
    ),
    template: `<div class="tracker-data-grid">
    <div><strong>Name</strong></div><div>{{name}}</div>
    <div><strong>Class</strong></div><div>{{class}}</div>
    <div><strong>Age</strong></div><div>{{age}}</div>
    <div><strong>HP</strong></div><div>{{hp}} / {{max_hp}}</div>
</div>
<p><strong>Summary:</strong> {{short_summary}}</p>`,
  },
  {
    name: 'Quest Log',
    schema: JSON.stringify(
      {
        type: 'object',
        properties: {
          quest_title: { type: 'string', description: 'The title of the current quest.' },
          objective: { type: 'string', description: 'The primary objective of the quest.' },
          status: {
            type: 'string',
            enum: ['Active', 'Completed', 'Failed'],
            description: 'The current status of the quest.',
          },
          key_characters: {
            type: 'array',
            items: { type: 'string' },
            description: 'A list of key characters involved.',
          },
        },
        required: ['quest_title', 'objective', 'status'],
      },
      null,
      2,
    ),
    template: `<h4>{{quest_title}}</h4>
<div class="tracker-data-grid">
    <div><strong>Status</strong></div><div class="status-{{lowercase status}}">{{status}}</div>
    <div><strong>Objective</strong></div><div>{{objective}}</div>
    <div><strong>Key NPCs</strong></div><div>{{#if key_characters}}{{join key_characters ", "}}{{else}}None{{/if}}</div>
</div>`,
  },
];

export const DEFAULT_PROMPT = `Your task is to act as a meticulous data analyst.
Analyze the following message and extract key information based on the structure provided to you.`;

export const DEFAULT_SETTINGS: TrackerSettings = {
  enabled: false,
  connectionProfile: undefined,
  autoMode: 'none',
  promptEngineering: 'native',
  schemaPresets: DEFAULT_PRESETS,
  activeSchemaPresetName: 'Character Sheet',
  prompt: DEFAULT_PROMPT,
  maxResponseTokens: 16000,
  includeLastXMessages: 5,
  includeLastXTrackers: 3,
};
