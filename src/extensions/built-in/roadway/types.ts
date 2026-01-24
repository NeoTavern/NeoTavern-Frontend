export interface RoadwaySettings {
  enabled: boolean;
  autoMode: boolean;

  choiceGenConnectionProfile: string;
  choiceGenPrompt: string;
  choiceCount: number;
  structuredRequestFormat: 'native' | 'json' | 'xml';

  impersonateConnectionProfile: string;
  impersonatePrompt: string;
}

export interface RoadwayChatExtraData {
  enabled?: boolean;
}

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

export const DEFAULT_CHOICE_GEN_PROMPT = `You are an assistant guiding a creative writing session. Your task is to propose {{choiceCount}} compelling and diverse options for the story's next step, based on the provided chat history. These options should offer different narrative paths and perspectives.

The options can be, but are not limited to:
- A direct action or dialogue from the {{user}}'s perspective, matching the established writing style (e.g., first-person, third-person).
- An internal thought or reflection from {{user}}.
- A description of an environmental event or a change in the scene (e.g., "The old clock on the wall suddenly chimes thirteen.", "A thick fog begins to roll in from the sea.").
- An action or line of dialogue from a secondary character present in the scene.
- A new character entering the scene.
- A sudden plot twist or unexpected event.

A single choice can also be a combination of these elements (e.g., an action followed by dialogue). The choices should vary in tone (e.g., curious, assertive, cautious, humorous) and consequence.

Present each choice as a complete, ready-to-use piece of text.`;

export const DEFAULT_IMPERSONATE_PROMPT = `Based on the chat history and the {{user}}'s general writing style, take the following directive and expand it into a full, detailed response. The response should seamlessly continue the narrative, maintaining the established point of view (e.g., first-person, third-person) and tone. Write the response as if you were the user continuing the story.

Directive: {{choice}}`;

export const DEFAULT_SETTINGS: RoadwaySettings = {
  enabled: true,
  autoMode: false,
  choiceGenConnectionProfile: '',
  choiceGenPrompt: DEFAULT_CHOICE_GEN_PROMPT,
  choiceCount: 5,
  structuredRequestFormat: 'native',
  impersonateConnectionProfile: '',
  impersonatePrompt: DEFAULT_IMPERSONATE_PROMPT,
};
