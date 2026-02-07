import { genInitialScene } from './llm';
import type { MythicExtensionAPI, Scene } from './types';

export async function generateInitialScene(
  api: MythicExtensionAPI,
  signal?: AbortSignal,
  generateUNEProfiles = false,
): Promise<Scene> {
  return await genInitialScene(api, signal, generateUNEProfiles);
}
