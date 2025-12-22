import { get, set } from 'lodash-es';
import {
  CHARACTER_FIELD_MAPPINGS,
  default_avatar,
  depth_prompt_depth_default,
  depth_prompt_role_default,
  talkativeness_default,
} from '../constants';
import { useCharacterStore } from '../stores/character.store';
import { usePersonaStore } from '../stores/persona.store';
import { type Character, type ThumbnailType } from '../types';

// --- Manipulation & Form Data ---

export function getCharacterDifferences(oldChar: Character, newChar: Character): Partial<Character> | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const diffs: Record<string, any> = {};

  for (const [frontendKey, backendPath] of Object.entries(CHARACTER_FIELD_MAPPINGS)) {
    const newValue = get(newChar, frontendKey);
    const oldValue = get(oldChar, frontendKey);

    if (newValue !== undefined && JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
      set(diffs, backendPath, newValue);
      set(diffs, frontendKey, newValue);
    }
  }

  if (newChar.data) {
    const backendDataPath = 'data';
    const newData = newChar.data;
    const oldData = oldChar.data || {};
    const ignoreKeys = ['extensions'];

    for (const key in newData) {
      if (ignoreKeys.includes(key)) continue;
      const newSubValue = newData[key];
      const oldSubValue = oldData[key];
      if (JSON.stringify(newSubValue) !== JSON.stringify(oldSubValue)) {
        set(diffs, `${backendDataPath}.${key}`, newSubValue);
      }
    }
  }

  return Object.keys(diffs).length > 0 ? diffs : null;
}

export function createCharacterFormData(character: Character, fileToSend: File | null, uuid: string): FormData {
  const formData = new FormData();

  formData.append('ch_name', character.name);
  if (fileToSend) formData.append('avatar', fileToSend);
  formData.append('preserved_name', uuid);
  formData.append('fav', String(character.fav || false));
  formData.append('description', character.description || '');
  formData.append('first_mes', character.first_mes || '');

  // Legacy/Compatibility fields
  formData.append('json_data', '');
  formData.append('avatar_url', '');
  formData.append('chat', '');
  formData.append('create_date', '');
  formData.append('last_mes', '');
  formData.append('world', '');

  // Data fields
  formData.append('system_prompt', character.data?.system_prompt || '');
  formData.append('post_history_instructions', character.data?.post_history_instructions || '');
  formData.append('creator', character.data?.creator || '');
  formData.append('character_version', character.data?.character_version || '');
  formData.append('creator_notes', character.data?.creator_notes || '');
  formData.append('tags', (character.tags || []).join(','));
  formData.append('personality', character.personality || '');
  formData.append('scenario', character.scenario || '');

  // Depth Prompt
  formData.append('depth_prompt_prompt', character.data?.depth_prompt?.prompt || '');
  formData.append('depth_prompt_depth', String(character.data?.depth_prompt?.depth ?? depth_prompt_depth_default));
  formData.append('depth_prompt_role', character.data?.depth_prompt?.role || depth_prompt_role_default);

  if (character.data?.character_book) {
    formData.append('character_book', JSON.stringify(character.data.character_book));
  }

  formData.append('talkativeness', String(character.talkativeness ?? talkativeness_default));
  formData.append('mes_example', character.mes_example || '');
  formData.append('extensions', JSON.stringify({}));

  return formData;
}

export function filterAndSortCharacters(characters: Character[], searchTerm: string, sortOrder: string): Character[] {
  const lowerSearchTerm = searchTerm.toLowerCase();
  const filteredCharacters =
    lowerSearchTerm.length > 0
      ? characters.filter((char) => {
          return (
            char.name.toLowerCase().includes(lowerSearchTerm) ||
            char.description?.toLowerCase().includes(lowerSearchTerm) ||
            char.tags?.join(',').toLowerCase().includes(lowerSearchTerm)
          );
        })
      : characters;

  const [sortKey, sortDir] = sortOrder.split(':') as ['name' | 'create_date' | 'fav', 'asc' | 'desc'];

  return [...filteredCharacters].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'name':
        return a.name.localeCompare(b.name) * dir;
      case 'create_date': {
        const dateA = a.create_date ? new Date(a.create_date).getTime() : 0;
        const dateB = b.create_date ? new Date(b.create_date).getTime() : 0;
        return (dateA - dateB) * dir;
      }
      case 'fav': {
        const favA = a.fav ? 1 : 0;
        const favB = b.fav ? 1 : 0;
        if (favA !== favB) return favB - favA;
        return a.name.localeCompare(b.name);
      }
      default:
        return 0;
    }
  });
}

// --- Image & Assets ---

export function getThumbnailUrl(type: ThumbnailType, file: string | undefined, timestampOverride?: number): string {
  if (!file || file === 'none') {
    return default_avatar;
  }

  let timestamp = timestampOverride;

  if (!timestamp) {
    if (type === 'persona') {
      const personaStore = usePersonaStore();
      timestamp = personaStore.lastAvatarUpdate;
    } else if (type === 'avatar') {
      const charStore = useCharacterStore();
      timestamp = charStore.characterImageTimestamps[file];
    }
  }

  const query = timestamp ? `&t=${timestamp}` : '';
  return `/thumbnail?type=${type}&file=${encodeURIComponent(file)}${query}`;
}

interface AvatarDetails {
  type: ThumbnailType;
  file?: string;
  isUser: boolean;
  forceAvatar?: string;
  activePlayerAvatar?: string | null;
}

export function resolveAvatarUrls(details: AvatarDetails): { thumbnail: string; full: string } {
  if (details.forceAvatar) {
    return { thumbnail: details.forceAvatar, full: details.forceAvatar };
  }

  if (details.isUser) {
    const userAvatarFile = details.activePlayerAvatar ?? undefined;
    const thumbnail = getThumbnailUrl('persona', userAvatarFile);
    const full = userAvatarFile ? `/personas/${userAvatarFile}` : default_avatar;
    return { thumbnail, full };
  }

  const characterAvatarFile = details.file;
  const thumbnail = getThumbnailUrl(details.type, characterAvatarFile);
  const full = characterAvatarFile ? `/characters/${characterAvatarFile}` : default_avatar;
  return { thumbnail, full };
}
