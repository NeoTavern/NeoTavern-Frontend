import localforage from 'localforage';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ExtensionPrompt, ItemizedPrompt } from '../types';

const promptStorage = localforage.createInstance({ name: 'SillyTavern_Prompts' });
const userTypingStorage = localforage.createInstance({ name: 'SillyTavern_UserTyping' });

export const usePromptStore = defineStore('prompt', () => {
  const extensionPrompts = ref<Record<string, ExtensionPrompt>>({});
  const itemizedPrompts = ref<ItemizedPrompt[]>([]);

  async function saveItemizedPrompts(chatId?: string) {
    try {
      if (!chatId) {
        return;
      }
      await promptStorage.setItem(chatId, JSON.parse(JSON.stringify(itemizedPrompts.value)));
    } catch {
      console.log('Error saving itemized prompts for chat', chatId);
    }
  }

  async function saveUserTyping(chatId: string, userInput: string) {
    try {
      if (!chatId) {
        return;
      }
      await userTypingStorage.setItem(chatId, userInput);
    } catch {
      console.log('Error saving user typing for chat', chatId);
    }
  }

  async function loadUserTyping(chatId: string): Promise<string> {
    try {
      if (!chatId) {
        return '';
      }
      const userInput = (await userTypingStorage.getItem(chatId)) as string | null;
      return userInput ?? '';
    } catch {
      console.log('Error loading user typing for chat', chatId);
      return '';
    }
  }

  async function clearUserTyping(chatId: string) {
    try {
      if (!chatId) {
        return;
      }
      await userTypingStorage.removeItem(chatId);
    } catch {
      console.log('Error clearing user typing for chat', chatId);
    }
  }

  async function loadItemizedPrompts(chatId?: string) {
    try {
      if (!chatId) {
        itemizedPrompts.value = [];
        return;
      }
      const prompts = (await promptStorage.getItem(chatId)) as ItemizedPrompt[] | null;
      itemizedPrompts.value = prompts ?? [];
    } catch {
      console.log('Error loading itemized prompts for chat', chatId);
      itemizedPrompts.value = [];
    }
  }

  function addItemizedPrompt(prompt: ItemizedPrompt) {
    const existingIndex = itemizedPrompts.value.findIndex((p) => p.messageIndex === prompt.messageIndex);
    if (existingIndex > -1) {
      itemizedPrompts.value[existingIndex] = prompt;
    } else {
      itemizedPrompts.value.push(prompt);
    }
  }

  function getItemizedPrompt(messageIndex: number): ItemizedPrompt | undefined {
    return itemizedPrompts.value.find((p) => p.messageIndex === messageIndex);
  }

  return {
    extensionPrompts,
    itemizedPrompts,
    saveItemizedPrompts,
    loadItemizedPrompts,
    addItemizedPrompt,
    getItemizedPrompt,
    saveUserTyping,
    loadUserTyping,
    clearUserTyping,
  };
});
