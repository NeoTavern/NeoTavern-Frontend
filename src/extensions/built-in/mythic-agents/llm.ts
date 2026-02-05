import { uuidv4 } from '../../../utils/commons';
import { ANALYSIS_PROMPT, INITIAL_SCENE_PROMPT, NARRATION_PROMPT, SCENE_UPDATE_PROMPT } from './prompts';
import type { AnalysisOutput, MythicCharacter, MythicExtensionAPI, Scene, SceneUpdate } from './types';
import { AnalysisOutputSchema, SceneSchema, SceneUpdateSchema } from './types';
import { genUNENpc } from './une';

export async function analyzeUserAction(
  api: MythicExtensionAPI,
  scene: Scene,
  signal?: AbortSignal,
): Promise<AnalysisOutput> {
  const settings = api.settings.get();
  const connectionProfile = settings?.connectionProfileId || api.settings.getGlobal('api.selectedConnectionProfile');

  const processedPrompt = api.macro.process(settings.prompts.analysis || ANALYSIS_PROMPT, undefined, {
    scene,
    language_name: settings?.language || 'English',
  });
  const itemizedPrompt = await api.chat.buildPrompt();
  const messages = itemizedPrompt.messages;
  messages.push({ role: 'user', name: 'User', content: processedPrompt });

  return new Promise(async (resolve, reject) => {
    const response = await api.llm.generate(messages, {
      connectionProfile,
      signal,
      structuredResponse: {
        schema: { name: 'analysis_output', strict: true, value: AnalysisOutputSchema.toJSONSchema() },
        format: 'json',
      },
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
  const itemizedPrompt = await api.chat.buildPrompt();
  const messages = itemizedPrompt.messages;
  messages.push({ role: 'user', name: 'User', content: processedPrompt });

  return new Promise(async (resolve, reject) => {
    const response = await api.llm.generate(messages, {
      connectionProfile,
      signal,
      structuredResponse: {
        schema: { name: 'initial_scene', strict: true, value: SceneSchema.toJSONSchema() },
        format: 'json',
      },
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

export async function genSceneUpdate(
  api: MythicExtensionAPI,
  currentScene: Scene,
  signal?: AbortSignal,
): Promise<Scene> {
  const settings = api.settings.get();
  const connectionProfile = settings?.connectionProfileId || api.settings.getGlobal('api.selectedConnectionProfile');

  const processedPrompt = api.macro.process(settings.prompts.sceneUpdate || SCENE_UPDATE_PROMPT, undefined, {
    scene: currentScene,
    language_name: settings?.language || 'English',
  });

  const itemizedPrompt = await api.chat.buildPrompt();
  const messages = itemizedPrompt.messages;
  messages.push({ role: 'user', name: 'User', content: processedPrompt });

  return new Promise(async (resolve, reject) => {
    const response = await api.llm.generate(messages, {
      connectionProfile,
      signal,
      structuredResponse: {
        schema: { name: 'scene_update', strict: true, value: SceneUpdateSchema.toJSONSchema() },
        format: 'json',
      },
      onCompletion: ({ structured_content, parse_error }) => {
        if (structured_content) {
          const update = structured_content as SceneUpdate;
          // Apply updates
          const existingChars = new Map(currentScene.characters.map((c) => [c.name.toLowerCase(), c]));
          const newCharacters: MythicCharacter[] = [];
          for (const char of update.characters) {
            const key = char.name.toLowerCase();
            if (existingChars.has(key)) {
              newCharacters.push(existingChars.get(key)!);
            } else {
              // New character, generate UNE
              newCharacters.push({
                id: uuidv4(),
                name: char.name,
                type: char.type,
                une_profile: genUNENpc(),
              });
            }
          }
          let newChaos = currentScene.chaos_rank;
          if (update.scene_outcome === 'chaotic') {
            newChaos = Math.min(9, newChaos + 1);
          } else if (update.scene_outcome === 'player_in_control') {
            newChaos = Math.max(1, newChaos - 1);
          }
          const newScene: Scene = {
            chaos_rank: newChaos,
            characters: newCharacters,
            threads: update.threads,
          };
          resolve(newScene);
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
  });

  const chatInfo = api.chat.getChatInfo();
  const messageIndex = chatInfo?.chat_items ?? 0;
  const generationId = uuidv4();

  const itemizedPrompt = await api.chat.buildPrompt({ generationId, messageIndex });
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
