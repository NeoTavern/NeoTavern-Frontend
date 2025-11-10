import { atom } from 'nanostores';
import localforage from 'localforage';
import type { ExtensionPrompt } from '../types';

export const extensionPrompts = atom<Record<string, ExtensionPrompt>>({});
export const itemizedPrompts = atom<Array<any>>([]);

const promptStorage = localforage.createInstance({ name: 'SillyTavern_Prompts' });

/**
 * Saves the itemized prompts for a chat.
 */
export async function saveItemizedPrompts(chatId?: string) {
  try {
    if (!chatId) {
      return;
    }

    await promptStorage.setItem(chatId, itemizedPrompts.get());
  } catch {
    console.log('Error saving itemized prompts for chat', chatId);
  }
}

export async function loadItemizedPrompts(chatId?: string) {
  try {
    if (!chatId) {
      itemizedPrompts.set([]);
      return;
    }

    const prompts = await promptStorage.getItem(chatId);
    itemizedPrompts.set((prompts as any[]) ?? []);
  } catch {
    console.log('Error loading itemized prompts for chat', chatId);
    itemizedPrompts.set([]);
  }
}
