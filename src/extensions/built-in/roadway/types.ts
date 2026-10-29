import {
  migratePromptPresetSettings,
  resolvePromptPreset,
  type PromptPreset,
  type PromptPresetState,
} from '../_shared/prompt-presets';

export type RoadwayPrompts = {
  choiceGenPrompt: string;
  impersonatePrompt: string;
};

export interface RoadwaySettings extends PromptPresetState<RoadwayPrompts> {
  enabled: boolean;
  autoMode: boolean;

  choiceGenConnectionProfile: string;
  choiceGenPrompt?: string;
  choiceCount: number;
  structuredRequestFormat: 'native' | 'json' | 'xml';

  impersonateConnectionProfile: string;
  impersonatePrompt?: string;
}

export type RoadwayChatExtraData = Record<string, never>;

export interface RoadwayMessageExtraData {
  choices?: string[];
  choiceMade?: boolean;
  isGeneratingChoices?: boolean;
}

export interface RoadwayChatExtra {
  'core.roadway'?: RoadwayChatExtraData;
}

export interface RoadwayMessageExtra {
  'core.roadway'?: RoadwayMessageExtraData;
}

export const DEFAULT_CHOICE_GEN_PROMPT = `You help the human continue an ongoing roleplay. Based on the established chat history, propose several meaningfully different possible next messages for {{user}}. Each suggestion must be complete, ready to send as {{user}}'s next turn, and useful for moving the scene forward. Aim for around {{choiceCount}} suggestions, but prioritize distinct, useful choices over an exact count.

{{#if input}}
The {{user}} has an in-progress draft in the chat input:
{{input}}

Treat the draft as the {{user}}'s current intent. Suggest ways to continue, refine, or branch from it without discarding its substance.
{{/if}}

Follow these priorities:
- Control only {{user}}. Do not write another character's dialogue, voluntary action, private thought, emotion, decision, or guaranteed reaction. {{user}} may attempt something, ask a question, or address another character, but the outcome must remain open.
- Match {{user}}'s established point of view, tense, language, tone, and typical amount of detail.
- Treat established events and relationship development as canon. Do not reset a resolved conflict or contradict the current practical state.
- Do not invent prior relationships, contacts, possessions, skills, off-screen preparation, or private knowledge for {{user}} merely to make a suggestion specific.
- Make the suggestions different in intent and consequence, not merely rephrasings. When the scene supports them, vary the approach among action, dialogue, investigation, caution, humor, vulnerability, disagreement, or a change of immediate goal.
- Prefer concise suggestions that the human can scan and edit quickly. Stop each one when it creates an opening for the other characters or the world to respond.
- Do not include analysis, option labels, transcript labels, planning checklists, or commentary inside a suggestion.`;

export const DEFAULT_IMPERSONATE_PROMPT = `Based on the chat history and the {{user}}'s general writing style, take the following directive and expand it into a full, detailed response. The response should seamlessly continue the narrative, maintaining the established point of view (e.g., first-person, third-person) and tone. Write the response as if you were the user continuing the story.

Directive: {{choice}}`;

export const BUILT_IN_PROMPT_PRESETS: PromptPreset<RoadwayPrompts>[] = [
  {
    id: 'default',
    name: 'Default',
    builtIn: true,
    prompts: {
      choiceGenPrompt: DEFAULT_CHOICE_GEN_PROMPT,
      impersonatePrompt: DEFAULT_IMPERSONATE_PROMPT,
    },
  },
];

export const DEFAULT_SETTINGS: RoadwaySettings = {
  enabled: true,
  autoMode: false,
  choiceGenConnectionProfile: '',
  choiceCount: 5,
  structuredRequestFormat: 'native',
  impersonateConnectionProfile: '',
  activePromptPresetId: 'default',
  promptPresets: [],
  promptPresetMigrationVersion: 1,
};

export function migrateRoadwaySettings(settings: Partial<RoadwaySettings> = {}): RoadwaySettings {
  return migratePromptPresetSettings({
    settings,
    defaultSettings: DEFAULT_SETTINGS,
    builtInPresets: BUILT_IN_PROMPT_PRESETS,
    legacyPrompts: {
      choiceGenPrompt: settings.choiceGenPrompt,
      impersonatePrompt: settings.impersonatePrompt,
    },
    legacyDefaults: {
      choiceGenPrompt: DEFAULT_CHOICE_GEN_PROMPT,
      impersonatePrompt: DEFAULT_IMPERSONATE_PROMPT,
    },
  });
}

export function resolveRoadwayPrompts(settings: RoadwaySettings): RoadwayPrompts {
  return resolvePromptPreset(settings, BUILT_IN_PROMPT_PRESETS).prompts;
}
