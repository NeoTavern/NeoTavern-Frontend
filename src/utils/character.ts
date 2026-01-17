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

    // Get the list of data fields that are already mapped to top-level properties
    // e.g., 'data.description' -> we should ignore 'description' key in data object
    const mappedDataFields = Object.values(CHARACTER_FIELD_MAPPINGS)
      .filter((path) => path.startsWith('data.'))
      .map((path) => path.replace('data.', ''));

    for (const key in newData) {
      if (ignoreKeys.includes(key)) continue;
      // If this data field is already handled by a top-level mapping, skip it
      if (mappedDataFields.includes(key)) continue;

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

export function filterAndSortCharacters(
  characters: Character[],
  searchTerm: string,
  filterTags: string[],
  sortOrder: string,
  getCustomTags: (avatar: string) => string[],
): Character[] {
  // 1. Filter
  const lowerSearchTerm = searchTerm.toLowerCase();
  const filteredCharacters = characters.filter((char) => {
    const searchFilter =
      lowerSearchTerm.length === 0 ||
      char.name.toLowerCase().includes(lowerSearchTerm) ||
      char.description?.toLowerCase().includes(lowerSearchTerm) ||
      char.tags?.join(',').toLowerCase().includes(lowerSearchTerm);

    if (!searchFilter) return false;

    if (filterTags.length === 0) return true;
    const allTags = new Set([...(char.tags ?? []), ...getCustomTags(char.avatar)]);
    // AND Logic: Character must have all of the selected tags
    return filterTags.every((tag) => allTags.has(tag));
  });

  // 2. Sort
  const [sortKey, sortDir] = sortOrder.split(':') as ['name' | 'create_date' | 'fav' | 'random', 'asc' | 'desc'];

  if (sortKey === 'random') {
    return [...filteredCharacters].sort(() => Math.random() - 0.5);
  }

  return [...filteredCharacters].sort((a, b) => {
    // For non-fav sort modes, always prioritize favorited characters
    if (sortKey !== 'fav') {
      const favSort = (b.fav ? 1 : 0) - (a.fav ? 1 : 0);
      if (favSort !== 0) return favSort;
    }

    let result = 0;
    switch (sortKey) {
      case 'name':
        result = a.name.localeCompare(b.name);
        break;
      case 'create_date': {
        const dateA = a.create_date ? new Date(a.create_date).getTime() : 0;
        const dateB = b.create_date ? new Date(b.create_date).getTime() : 0;
        result = dateA - dateB;
        break;
      }
      case 'fav':
        result = (b.fav ? 1 : 0) - (a.fav ? 1 : 0);
        // Add a name-based tie-breaker for fav sort
        if (result === 0) {
          result = a.name.localeCompare(b.name);
        }
        break;
      default:
        break;
    }

    // For fav sort, direction is always descending (favs first). The result already reflects this.
    if (sortKey === 'fav') {
      return result;
    }

    return sortDir === 'asc' ? result : -result;
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
