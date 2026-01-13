import DOMPurify from 'dompurify';
import { merge } from 'lodash-es';
import { defineStore } from 'pinia';
import { computed, nextTick, ref } from 'vue';
import { useAutoSave } from '../composables/useAutoSave';
import { useCharacterTokens } from '../composables/useCharacterTokens';
import { characterService } from '../services/character.service';
import { chatService } from '../services/chat.service';
import { type Character, type CropData } from '../types';
import { getCharacterDifferences } from '../utils/character';
import { onlyUnique } from '../utils/commons';
import { eventEmitter } from '../utils/extensions';
import { useSettingsStore } from './settings.store';

export const useCharacterStore = defineStore('character', () => {
  const settingsStore = useSettingsStore();
  const { tokenCounts, totalTokens, permanentTokens, calculateAllTokens } = useCharacterTokens();

  const characters = ref<Array<Character>>([]);
  const activeCharacterAvatars = ref<Set<string>>(new Set());
  const characterImageTimestamps = ref<Record<string, number>>({});

  const activeCharacters = computed<Character[]>(() => {
    return characters.value.filter((char) => activeCharacterAvatars.value.has(char.avatar));
  });

  async function refreshCharacters() {
    try {
      const newCharacters = await characterService.fetchAll();
      characters.value = newCharacters;

      const now = Date.now();
      for (const char of newCharacters) {
        if (!characterImageTimestamps.value[char.avatar]) {
          characterImageTimestamps.value[char.avatar] = now;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Failed to fetch characters:', error);
      if (error.message === 'overflow') {
        throw new Error('overflow');
      }
    }
  }

  // Debounced save for a specific character update
  const { trigger: triggerSave } = useAutoSave(
    async (payload: { avatar: string; changes: Partial<Character> }) => {
      await characterService.saveChanges(payload.avatar, payload.changes);
    },
    { timeout: 500 },
  );

  useAutoSave(
    async () => {
      await refreshCharacters();
    },
    { timeout: 1000 },
  );

  async function updateAndSaveCharacter(avatar: string, changes: Partial<Character>) {
    if (Object.keys(changes).length === 0) return;

    // Optimistic Update
    const index = characters.value.findIndex((c) => c.avatar === avatar);
    if (index !== -1) {
      const updatedCharacter = merge({}, characters.value[index], changes);
      updatedCharacter.name = DOMPurify.sanitize(updatedCharacter.name);
      characters.value[index] = updatedCharacter;

      // Trigger debounced API call
      triggerSave({ avatar, changes });

      await nextTick();
      await eventEmitter.emit('character:updated', updatedCharacter, changes);
    } else {
      console.warn(`Saved character with avatar ${avatar} not found locally.`);
      await refreshCharacters();
    }
  }

  async function renameCharacter(avatar: string, newName: string) {
    const character = characters.value.find((c) => c.avatar === avatar);
    if (!character) return;
    const changes = getCharacterDifferences(character, { ...character, name: newName });
    if (!changes) return;
    await updateAndSaveCharacter(avatar, changes);
  }

  async function saveCharacter(characterData: Character, originalCharacter?: Character) {
    if (!originalCharacter) return;
    const changes = getCharacterDifferences(originalCharacter, characterData);
    if (changes) {
      await updateAndSaveCharacter(originalCharacter.avatar, changes);
      if ('first_mes' in changes && changes.first_mes !== undefined) {
        await eventEmitter.emit('character:first-message-updated', originalCharacter.avatar, characterData);
      }
    }
  }

  async function importCharacter(file: File): Promise<string | undefined> {
    try {
      const avatarFileName = await characterService.import(file);
      await refreshCharacters();

      const importedChar = characters.value.find((c) => c.avatar === avatarFileName);
      if (importedChar) {
        await nextTick();
        await eventEmitter.emit('character:imported', importedChar);
      }
      return avatarFileName;
    } catch (error) {
      console.error('Error importing character', error);
      throw error;
    }
  }

  async function importTagsForCharacters(avatarFileNames: string[]): Promise<Record<string, string[]>> {
    const results: Record<string, string[]> = {};
    const setting = settingsStore.settings.character.tagImportSetting;

    if (setting === 'none') return results;

    for (const avatar of avatarFileNames) {
      const character = characters.value.find((c) => c.avatar === avatar);
      if (character) {
        const tagsToImport = characterService.getImportTags(character, setting);
        if (tagsToImport.length > 0) {
          const newTags = [...(character.tags ?? []), ...tagsToImport].filter(onlyUnique);
          const changes = getCharacterDifferences(character, { ...character, tags: newTags });
          if (changes) {
            await updateAndSaveCharacter(character.avatar, changes);
            results[avatar] = tagsToImport;
          }
        }
      }
    }
    return results;
  }

  async function createNewCharacter(
    character: Character,
    file?: File,
    cropData?: CropData,
  ): Promise<string | undefined> {
    const result = await characterService.create(character, file, cropData);
    if (result) {
      await refreshCharacters();
      const createdChar = characters.value.find((c) => c.avatar === result.avatar);
      if (createdChar) {
        await nextTick();
        await eventEmitter.emit('character:created', createdChar);
        return createdChar.avatar;
      }
    }
  }

  async function deleteCharacter(avatar: string, deleteChats: boolean) {
    if (deleteChats) {
      // TODO: Move to noetavern backend
      const character = characters.value.find((c) => c.avatar === avatar);
      if (character && character.chat) {
        await chatService.delete(character.chat);
        await eventEmitter.emit('chat:deleted', character.chat);
      }
    }
    await characterService.delete(avatar, false);
    await eventEmitter.emit('character:deleted', avatar);

    const index = characters.value.findIndex((c) => c.avatar === avatar);
    if (index !== -1) {
      characters.value.splice(index, 1);
    }
    delete characterImageTimestamps.value[avatar];
  }

  async function updateCharacterImage(avatar: string, imageFile: File, cropData?: CropData) {
    await characterService.updateImage(avatar, imageFile, cropData);
    if (characters.value.find((c) => c.avatar === avatar)) {
      characterImageTimestamps.value[avatar] = Date.now();
    }
    await refreshCharacters();
  }

  async function duplicateCharacter(avatar: string) {
    const character = characters.value.find((c) => c.avatar === avatar);
    if (!character) return;

    const result = await characterService.duplicate(character);
    if (result) {
      await refreshCharacters();
      const createdChar = characters.value.find((c) => c.avatar === result.avatar);
      if (createdChar) {
        await eventEmitter.emit('character:created', createdChar);
      }
    }
  }

  function setActiveCharacterAvatars(avatars: string[]) {
    activeCharacterAvatars.value = new Set(avatars);
  }

  return {
    characters,
    activeCharacters,
    activeCharacterAvatars,
    characterImageTimestamps,
    refreshCharacters,
    saveCharacter,
    tokenCounts,
    totalTokens,
    permanentTokens,
    calculateAllTokens,
    importCharacter,
    importTagsForCharacters,
    createNewCharacter,
    renameCharacter,
    deleteCharacter,
    updateCharacterImage,
    updateAndSaveCharacter,
    duplicateCharacter,
    setActiveCharacterAvatars,
  };
});
