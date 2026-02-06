import type { StructuredResponseOptions } from '../../../types';
import type { ChatMessage } from '../../../types/chat';
import { uuidv4 } from '../../../utils/commons';
import { ANALYSIS_PROMPT, INITIAL_SCENE_PROMPT, NARRATION_PROMPT } from './prompts';
import type { AnalysisOutput, MythicCharacter, MythicExtensionAPI, Scene, SceneUpdate } from './types';
import { AnalysisOutputSchema, SceneSchema, SceneUpdateSchema } from './types';
import { genUNENpc } from './une';

export async function analyzeUserAction(
  api: MythicExtensionAPI,
  scene: Scene,
  chatHistory?: ChatMessage[],
  signal?: AbortSignal,
): Promise<AnalysisOutput> {
  const settings = api.settings.get();
  const connectionProfile = settings?.connectionProfileId || api.settings.getGlobal('api.selectedConnectionProfile');

  const processedPrompt = api.macro.process(settings.prompts.analysis || ANALYSIS_PROMPT, undefined, {
    scene,
    language_name: settings?.language || 'English',
  });
  const structuredResponse: StructuredResponseOptions = {
    schema: { name: 'analysis_output', strict: true, value: AnalysisOutputSchema.toJSONSchema() },
    format: 'json',
  };
  const itemizedPrompt = await api.chat.buildPrompt({ structuredResponse, chatHistory });
  const messages = itemizedPrompt.messages;
  messages.push({ role: 'user', name: 'User', content: processedPrompt });

  return new Promise(async (resolve, reject) => {
    const response = await api.llm.generate(messages, {
      connectionProfile,
      signal,
      samplerOverrides: {
        stream: false,
      },
      structuredResponse,
      onCompletion: ({ structured_content, parse_error }) => {
        if (structured_content) {
          resolve(structured_content as AnalysisOutput);
        } else if (parse_error) {
          reject(new Error(parse_error.message));
        } else {
          reject(new Error('No structured content or parse error'));
        }
      },
    });
    if (Symbol.asyncIterator in response) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of response) {
      }
    }
  });
}

export async function genInitialScene(api: MythicExtensionAPI, signal?: AbortSignal): Promise<Scene> {
  const settings = api.settings.get();
  const connectionProfile = settings?.connectionProfileId || api.settings.getGlobal('api.selectedConnectionProfile');

  const processedPrompt = api.macro.process(settings.prompts.initialScene || INITIAL_SCENE_PROMPT, undefined, {
    language_name: settings?.language || 'English',
  });
  const structuredResponse: StructuredResponseOptions = {
    schema: { name: 'initial_scene', strict: true, value: SceneSchema.toJSONSchema() },
    format: 'json',
  };
  const itemizedPrompt = await api.chat.buildPrompt({ structuredResponse });
  const messages = itemizedPrompt.messages;
  messages.push({ role: 'user', name: 'User', content: processedPrompt });

  return new Promise(async (resolve, reject) => {
    const response = await api.llm.generate(messages, {
      connectionProfile,
      signal,
      samplerOverrides: {
        stream: false,
      },
      structuredResponse,
      onCompletion: ({ structured_content, parse_error }) => {
        if (structured_content) {
          const scene = structured_content as Scene;
          scene.characters = scene.characters.map((char) => ({
            ...char,
            id: uuidv4(),
            une_profile: genUNENpc(),
          }));
          resolve(scene);
        } else if (parse_error) {
          reject(new Error(parse_error.message));
        } else {
          reject(new Error('No structured content or parse error'));
        }
      },
    });
    if (Symbol.asyncIterator in response) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of response) {
      }
    }
  });
}

export async function generateNarration(
  api: MythicExtensionAPI,
  scene: Scene,
  analysis: AnalysisOutput,
  fateRollResult: { roll: number; chaosDie: number; outcome: string; exceptional: boolean } | undefined,
  randomEvent: { focus: string; action: string; subject: string; new_npcs?: MythicCharacter[] } | undefined,
  messageIndex: number,
  swipeId: number = 0,
  chatHistory?: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const settings = api.settings.get();
  const connectionProfile = settings?.connectionProfileId || api.settings.getGlobal('api.selectedConnectionProfile');

  const processedPrompt = api.macro.process(settings.prompts.narration || NARRATION_PROMPT, undefined, {
    scene,
    analysis,
    fateRollResult,
    randomEvent,
    language_name: settings?.language || 'English',
    narrationRules: '',
    includeSceneUpdate: false,
  });

  const generationId = uuidv4();

  const itemizedPrompt = await api.chat.buildPrompt({ generationId, messageIndex, swipeId, chatHistory });
  const messages = [...itemizedPrompt.messages];
  messages.push({ role: 'user', name: 'User', content: processedPrompt });
  itemizedPrompt.messages = messages;

  const result = await api.llm.generate(messages, { connectionProfile, signal });
  let content = '';
  if ('content' in result) {
    content = result.content;
  } else {
    for await (const chunk of result) {
      content += chunk.delta;
    }
  }

  api.chat.addItemizedPrompt(itemizedPrompt);

  return content;
}

export async function generateNarrationAndSceneUpdate(
  api: MythicExtensionAPI,
  scene: Scene,
  analysis: AnalysisOutput,
  fateRollResult: { roll: number; chaosDie: number; outcome: string; exceptional: boolean } | undefined,
  randomEvent: { focus: string; action: string; subject: string; new_npcs?: MythicCharacter[] } | undefined,
  messageIndex: number,
  swipeId: number = 0,
  chatHistory?: ChatMessage[],
  signal?: AbortSignal,
): Promise<{ narration: string; sceneUpdate: SceneUpdate }> {
  const settings = api.settings.get();
  const connectionProfile = settings?.connectionProfileId || api.settings.getGlobal('api.selectedConnectionProfile');

  const processedPrompt = api.macro.process(settings.prompts.narration || NARRATION_PROMPT, undefined, {
    scene,
    analysis,
    fateRollResult,
    randomEvent,
    language_name: settings?.language || 'English',
    narrationRules: '',
    includeSceneUpdate: true,
  });

  const generationId = uuidv4();
  const structuredResponse: StructuredResponseOptions = {
    schema: {
      name: 'narration_and_scene_update',
      strict: true,
      value: {
        type: 'object',
        properties: {
          narration: { type: 'string' },
          sceneUpdate: SceneUpdateSchema.toJSONSchema(),
        },
        required: ['narration', 'sceneUpdate'],
      },
    },
    format: 'json',
  };

  const itemizedPrompt = await api.chat.buildPrompt({
    generationId,
    messageIndex,
    swipeId,
    structuredResponse,
    chatHistory,
  });
  const messages = [...itemizedPrompt.messages];
  messages.push({ role: 'user', name: 'User', content: processedPrompt });
  itemizedPrompt.messages = messages;
  api.chat.addItemizedPrompt(itemizedPrompt);

  return new Promise(async (resolve, reject) => {
    const response = await api.llm.generate(messages, {
      connectionProfile,
      signal,
      samplerOverrides: {
        stream: false,
      },
      structuredResponse,
      onCompletion: ({ structured_content, parse_error }) => {
        if (structured_content) {
          resolve(structured_content as { narration: string; sceneUpdate: SceneUpdate });
        } else if (parse_error) {
          reject(new Error(parse_error.message));
        } else {
          reject(new Error('No structured content or parse error'));
        }
      },
    });
    if (Symbol.asyncIterator in response) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of response) {
      }
    }
  });
}
