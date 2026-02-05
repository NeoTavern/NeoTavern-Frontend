import { genInitialScene, genSceneUpdate } from './llm';
import type { MythicExtensionAPI, Scene } from './types';

export async function generateInitialScene(api: MythicExtensionAPI, signal?: AbortSignal): Promise<Scene> {
  return await genInitialScene(api, signal);
}

export async function updateScene(api: MythicExtensionAPI, currentScene: Scene, signal?: AbortSignal): Promise<Scene> {
  return await genSceneUpdate(api, currentScene, signal);
}
