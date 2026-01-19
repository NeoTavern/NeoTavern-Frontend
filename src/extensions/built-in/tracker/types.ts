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
  parallelRequestLimit: number;
}

export interface TrackerData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trackerJson?: Record<string, any>;
  trackerHtml?: string;
  schemaName?: string;
  status: 'idle' | 'pending' | 'success' | 'error';
  error?: string;
}

export interface TrackerChatExtraData {
  schemaNames?: string[];
}

export interface TrackerMessageExtraData {
  trackers?: Record<string, TrackerData>;
}

export interface TrackerChatExtra {
  'core.tracker'?: TrackerChatExtraData;
}

export interface TrackerMessageExtra {
  'core.tracker'?: TrackerMessageExtraData;
}

export const DEFAULT_PROMPT = `You are a Scene Tracker Assistant, tasked with providing clear, consistent, and structured updates to a scene tracker for a roleplay. Use the latest message, previous tracker details, and context from recent messages to accurately update the tracker. Your response must ensuring that each field is filled and complete. If specific information is not provided, make reasonable assumptions based on prior descriptions, logical inferences, or default character details.

### Key Instructions:
1. **Default Assumptions for Missing Information**:
   - **Character Details**: If no new details are provided for a character, assume reasonable defaults (e.g., hairstyle, posture, or attire based on previous entries or context).
   - **Outfit**: Describe the complete outfit for each character, using specific details for color, fabric, and style (e.g., “fitted black leather jacket with silver studs on the collar”). **Underwear must always be included in the outfit description.** If underwear is intentionally missing, specify this clearly in the description (e.g., "No bra", "No panties"). If the character is undressed, list the entire outfit.
   - **StateOfDress**: Describe how put-together or disheveled the character appears, including any removed clothing. If the character is undressed, indicate where discarded items are placed.
2. **Incremental Time Progression**:
   - Adjust time in small increments, ideally only a few seconds per update, to reflect realistic scene progression. Avoid large jumps unless a significant time skip (e.g., sleep, travel) is explicitly stated.
   - Format the time as "HH:MM:SS; MM/DD/YYYY (Day Name)".
3. **Context-Appropriate Times**:
   - Ensure that the time aligns with the setting. For example, if the scene takes place in a public venue (e.g., a mall), choose an appropriate time within standard operating hours.
4. **Location Format**: Avoid unintended reuse of specific locations from previous examples or responses. Provide specific, relevant, and detailed locations based on the context, using the format:
   - **Example**: “Food court, second floor near east wing entrance, Madison Square Mall, Los Angeles, CA”
5. **Topics Format**: Ensure topics are one- or two-word keywords relevant to the scene to help trigger contextual information. Avoid long phrases.
6. **Avoid Redundancies**: Use only details provided or logically inferred from context. Do not introduce speculative or unnecessary information.
7. **Focus and Pause**: Treat each scene update as a standalone, complete entry. Respond with the full tracker every time, even if there are only minor updates.

### Important Reminders:
1. **Recent Messages and Current Tracker**: Before updating, always consider the recent messages to ensure all changes are accurately represented.

Your primary objective is to ensure clarity, consistency, providing complete details even when specifics are not explicitly stated.`;

export const DEFAULT_SCHEMA_VALUE = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'SceneTracker',
  description: 'Schema for tracking roleplay scene details',
  type: 'object',
  properties: {
    time: {
      type: 'string',
      description: 'Format: HH:MM:SS; MM/DD/YYYY (Day Name)',
    },
    location: {
      type: 'string',
      description: 'Specific scene location with increasing specificity',
    },
    weather: {
      type: 'string',
      description: 'Current weather conditions and temperature',
    },
    topics: {
      type: 'object',
      properties: {
        primaryTopic: {
          type: 'string',
          description: '1-2 word main topic of interaction',
        },
        emotionalTone: {
          type: 'string',
          description: 'Dominant emotional tone of scene',
        },
        interactionTheme: {
          type: 'string',
          description: 'Type of character interaction',
        },
      },
      required: ['primaryTopic', 'emotionalTone', 'interactionTheme'],
    },
    charactersPresent: {
      type: 'array',
      items: {
        type: 'string',
        description: 'Character name',
      },
      description: 'List of character names present in scene',
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Character name',
          },
          hair: {
            type: 'string',
            description: 'Hairstyle and condition',
          },
          makeup: {
            type: 'string',
            description: "Makeup description or 'None'",
          },
          outfit: {
            type: 'string',
            description: 'Complete outfit including underwear',
          },
          stateOfDress: {
            type: 'string',
            description: 'How put-together/disheveled character appears',
          },
          postureAndInteraction: {
            type: 'string',
            description: "Character's physical positioning and interaction",
          },
        },
        required: ['name', 'hair', 'makeup', 'outfit', 'stateOfDress', 'postureAndInteraction'],
      },
      description: 'Array of character objects',
    },
  },
  required: ['time', 'location', 'weather', 'topics', 'charactersPresent', 'characters'],
};

export const DEFAULT_TEMPLATE = `<div class="tracker-data-grid">
    <div><strong>Time</strong></div><div>{{data.time}}</div>
    <div><strong>Location</strong></div><div>{{data.location}}</div>
    <div><strong>Weather</strong></div><div>{{data.weather}}</div>
</div>
<details class="tracker-details">
    <summary><strong>Scene Details</strong></summary>
    <div class="tracker-data-grid tracker-details-content">
        <div><strong>Topics</strong></div>
        <div>{{data.topics.primaryTopic}} • {{data.topics.emotionalTone}} • {{data.topics.interactionTheme}}</div>
        
        <div><strong>Present</strong></div>
        <div>{{join data.charactersPresent ", "}}</div>
    </div>
    
    <div class="tracker-characters">
        {{#each data.characters}}
        <div class="tracker-character-entry">
            <div class="tracker-character-name">{{name}}</div>
            <div class="tracker-data-grid">
                <div>Hair</div><div>{{hair}}</div>
                <div>Makeup</div><div>{{makeup}}</div>
                <div>Outfit</div><div>{{outfit}}</div>
                <div>State</div><div>{{stateOfDress}}</div>
                <div>Pos.</div><div>{{postureAndInteraction}}</div>
            </div>
        </div>
        {{/each}}
    </div>
</details>`;

export const DEFAULT_PRESETS: TrackerSchemaPreset[] = [
  {
    name: 'Scene Tracker',
    schema: JSON.stringify(DEFAULT_SCHEMA_VALUE, null, 2),
    template: DEFAULT_TEMPLATE,
  },
];

export const DEFAULT_SETTINGS: TrackerSettings = {
  enabled: false,
  connectionProfile: undefined,
  autoMode: 'none',
  promptEngineering: 'native',
  schemaPresets: DEFAULT_PRESETS,
  activeSchemaPresetName: 'Scene Tracker',
  prompt: DEFAULT_PROMPT,
  maxResponseTokens: 16000,
  includeLastXMessages: 5,
  includeLastXTrackers: 3,
  parallelRequestLimit: 2,
};
