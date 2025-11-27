import DOMPurify from 'dompurify';
import {
  createCharacter as apiCreateCharacter,
  deleteCharacter as apiDeleteCharacter,
  importCharacter as apiImportCharacter,
  saveCharacter as apiSaveCharacter,
  updateCharacterImage as apiUpdateCharacterImage,
  fetchAllCharacters,
} from '../api/characters';
import { type Character } from '../types/character';
import { createCharacterFormData, getThumbnailUrl } from '../utils/character';
import { uuidv4 } from '../utils/commons';

const IMPORT_EXCLUDED_TAGS: string[] = [];
const ANTI_TROLL_MAX_TAGS = 50;

export const characterService = {
  async fetchAll(): Promise<Character[]> {
    const chars = await fetchAllCharacters();
    // Sanitize and ensure chat ID
    for (const char of chars) {
      char.name = DOMPurify.sanitize(char.name);
      if (!char.chat) {
        char.chat = uuidv4();
      }
      char.chat = String(char.chat);
    }
    return chars;
  },

  async saveChanges(avatar: string, changes: Partial<Character>): Promise<void> {
    await apiSaveCharacter({ ...changes, avatar });
  },

  async create(character: Character, file?: File): Promise<{ avatar: string } | undefined> {
    const uuid = uuidv4();
    const fileName = `${uuid}.png`;
    const fileToSend = file ? new File([file], fileName, { type: file.type }) : null;
    const formData = createCharacterFormData(character, fileToSend, uuid);
    const result = await apiCreateCharacter(formData);

    if (result && result.file_name) {
      return { avatar: result.file_name };
    }
    return undefined;
  },

  async delete(avatar: string, deleteChats: boolean): Promise<void> {
    await apiDeleteCharacter(avatar, deleteChats);
  },

  async import(file: File): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['json', 'png'].includes(ext)) {
      throw new Error(`unsupported_type:${ext}`);
    }

    const uuid = uuidv4();
    const newFileName = `${uuid}.${ext}`;
    const renamedFile = new File([file], newFileName, { type: file.type });

    const data = await apiImportCharacter(renamedFile);
    if (data.file_name) {
      return `${data.file_name}.png`;
    }
    throw new Error('Import failed: No filename returned');
  },

  async updateImage(avatar: string, imageFile: File): Promise<void> {
    await apiUpdateCharacterImage(avatar, imageFile);
  },

  async duplicate(character: Character): Promise<{ avatar: string } | undefined> {
    const charCopy = { ...character, name: character.name };
    const uuid = uuidv4();
    charCopy.chat = uuid;
    delete charCopy.create_date;

    const url = getThumbnailUrl('avatar', character.avatar);
    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], 'avatar.png', { type: blob.type });

    return this.create(charCopy, file);
  },

  getImportTags(character: Character, importSetting: 'all' | 'ask' | 'only_existing' | 'none'): string[] {
    if (importSetting === 'none') return [];

    const alreadyAssignedTags = character.tags ?? [];
    const tagsFromCard = (character.tags ?? [])
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !IMPORT_EXCLUDED_TAGS.includes(t))
      .filter((t) => !alreadyAssignedTags.includes(t))
      .slice(0, ANTI_TROLL_MAX_TAGS);

    if (!tagsFromCard.length) return [];

    if (importSetting === 'all') {
      return tagsFromCard;
    }
    // 'ask' and 'only_existing' not fully implemented logic in original store either.
    return [];
  },
};
