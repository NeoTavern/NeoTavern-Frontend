import { defineStore } from 'pinia';
import { ref, computed, nextTick } from 'vue';
import type { Character } from '../types';
import {
  fetchAllCharacters,
  saveCharacter as apiSaveCharacter,
  fetchCharacterByAvatar,
  importCharacter as apiImportCharacter,
  createCharacter as apiCreateCharacter,
  deleteCharacter as apiDeleteCharacter,
  updateCharacterImage as apiUpdateCharacterImage,
} from '../api/characters';
import DOMPurify from 'dompurify';
import { humanizedDateTime } from '../utils/date';
import { toast } from '../composables/useToast';
import { useChatStore } from './chat.store';
import { useUiStore } from './ui.store';
import {
  CHARACTER_FIELD_MAPPINGS,
  DEFAULT_CHARACTER,
  DEFAULT_PRINT_TIMEOUT,
  DEFAULT_SAVE_EDIT_TIMEOUT,
  DebounceTimeout,
  depth_prompt_depth_default,
  depth_prompt_role_default,
  talkativeness_default,
} from '../constants';
import { useSettingsStore } from './settings.store';
import { onlyUnique } from '../utils/array';
import { useStrictI18n } from '../composables/useStrictI18n';
import { getFirstMessage } from '../utils/chat';
import { get, set, debounce } from 'lodash-es';
import { eventEmitter } from '../utils/event-emitter';
import { ApiTokenizer } from '../api/tokenizer';
import { getThumbnailUrl } from '../utils/image';

const ANTI_TROLL_MAX_TAGS = 50;
const IMPORT_EXLCUDED_TAGS: string[] = [];

export const useCharacterStore = defineStore('character', () => {
  const { t } = useStrictI18n();
  const settingsStore = useSettingsStore();
  const chatStore = useChatStore();
  const uiStore = useUiStore();
  const characters = ref<Array<Character>>([]);
  const favoriteCharacterChecked = ref<boolean>(false);
  const currentPage = ref(1);
  const itemsPerPage = ref(25);
  const highlightedAvatar = ref<string | null>(null);
  const tokenCounts = ref<{ total: number; permanent: number; fields: Record<string, number> }>({
    total: 0,
    permanent: 0,
    fields: {},
  });
  const searchTerm = ref('');

  const sortOrder = computed({
    get: () => settingsStore.settings.account.characterSortOrder ?? 'name:asc',
    set: (value) => (settingsStore.settings.account.characterSortOrder = value),
  });

  const isCreating = ref(false);
  const draftCharacter = ref<Character>(DEFAULT_CHARACTER);

  const activeCharacterAvatars = computed<Set<string>>(() => {
    const members = chatStore.activeChat?.metadata?.members;
    return new Set(members ?? []);
  });
  const activeCharacters = computed<Character[]>(() => {
    return characters.value.filter((char) => activeCharacterAvatars.value.has(char.avatar));
  });

  const editFormCharacter = computed<Character | null>(() => {
    if (isCreating.value) {
      return draftCharacter.value;
    }

    if (uiStore.selectedCharacterAvatarForEditing) {
      const editingCharacter = characters.value.find(
        (char) => char.avatar === uiStore.selectedCharacterAvatarForEditing,
      );
      if (editingCharacter) {
        return editingCharacter;
      }
    }

    return null;
  });

  const totalTokens = computed(() => tokenCounts.value.total);
  const permanentTokens = computed(() => tokenCounts.value.permanent);

  const displayableCharacters = computed<Character[]>(() => {
    // 1. Filter characters based on search term
    const lowerSearchTerm = searchTerm.value.toLowerCase();
    const filteredCharacters =
      lowerSearchTerm.length > 0
        ? characters.value.filter((char) => {
            return (
              char.name.toLowerCase().includes(lowerSearchTerm) ||
              char.description?.toLowerCase().includes(lowerSearchTerm) ||
              char.tags?.join(',').toLowerCase().includes(lowerSearchTerm)
            );
          })
        : characters.value;

    // 2. Sort the filtered characters
    const [sortKey, sortDir] = sortOrder.value.split(':') as ['name' | 'create_date' | 'fav', 'asc' | 'desc'];
    const sortedCharacters = [...filteredCharacters].sort((a, b) => {
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
          if (favA !== favB) return (favB - favA) * dir; // Favorites first
          return a.name.localeCompare(b.name); // Then sort by name
        }
        default:
          return 0;
      }
    });

    return sortedCharacters;
  });

  const paginatedCharacters = computed<Character[]>(() => {
    const totalItems = displayableCharacters.value.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage.value);

    if (currentPage.value > totalPages && totalPages > 0) {
      currentPage.value = totalPages;
    }

    const start = (currentPage.value - 1) * itemsPerPage.value;
    const end = start + itemsPerPage.value;
    return displayableCharacters.value.slice(start, end);
  });

  const refreshCharactersDebounced = debounce(() => {
    refreshCharacters();
  }, DEFAULT_PRINT_TIMEOUT);

  const calculateAllTokens = debounce(async (characterData: Partial<Character>) => {
    if (!characterData) {
      tokenCounts.value = { total: 0, permanent: 0, fields: {} };
      return;
    }

    const fieldPaths = [
      'description',
      'first_mes',
      'personality',
      'scenario',
      'mes_example',
      'data.system_prompt',
      'data.post_history_instructions',
      'data.depth_prompt.prompt',
    ];

    const tokenizer = ApiTokenizer.default;
    const newFieldCounts: Record<string, number> = {};
    const promises = fieldPaths.map((path) =>
      tokenizer.getTokenCount(get(characterData, path)).then((count) => {
        newFieldCounts[path] = count;
      }),
    );

    await Promise.all(promises);

    const total = Object.values(newFieldCounts).reduce((sum, count) => sum + count, 0);

    tokenCounts.value = {
      total: total,
      permanent: total, // TODO: Refine permanent token logic
      fields: newFieldCounts,
    };

    const settingsStore = useSettingsStore();
    const maxContext = settingsStore.settings.api.samplers.max_context;
    const warningThreshold = maxContext * 0.75;

    if (total > warningThreshold) {
      toast.warning(t('character.tokenWarning', { tokens: total, percentage: 75 }), undefined, { timeout: 8000 });
    }
  }, DebounceTimeout.RELAXED);

  async function refreshCharacters() {
    try {
      const newCharacters = await fetchAllCharacters();

      for (const char of newCharacters) {
        char.name = DOMPurify.sanitize(char.name);
        if (!char.chat) {
          char.chat = `${char.name} - ${humanizedDateTime()}`;
        }
        char.chat = String(char.chat);
      }

      characters.value = newCharacters;

      // TODO: refreshGroups()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Failed to fetch characters:', error);
      if (error.message === 'overflow') {
        toast.warning(t('character.fetch.overflowWarning'));
      }
    }
  }

  async function selectCharacterByAvatar(avatar: string) {
    const character = characters.value.find((c) => c.avatar === avatar);
    if (!character) {
      return;
    }

    // If we were creating, cancel it
    if (isCreating.value) {
      cancelCreating();
    }

    uiStore.selectedCharacterAvatarForEditing = avatar;
  }

  async function updateAndSaveCharacter(avatar: string, changes: Partial<Character>) {
    if (Object.keys(changes).length === 0) return;

    const dataToSave = { ...changes, avatar };
    try {
      await apiSaveCharacter(dataToSave);

      const updatedCharacter = await fetchCharacterByAvatar(avatar);
      updatedCharacter.name = DOMPurify.sanitize(updatedCharacter.name);

      const index = characters.value.findIndex((c) => c.avatar === avatar);
      if (index !== -1) {
        characters.value[index] = updatedCharacter;
        await nextTick();
        await eventEmitter.emit('character:updated', updatedCharacter, changes);
      } else {
        console.error(`Saved character with avatar ${avatar} not found in local list.`);
        toast.warning(t('character.save.syncWarning'));
      }
    } catch (error) {
      console.error('Failed to save character:', error);
      toast.error(t('character.save.error'));
    }
  }

  function getDifferences(oldChar: Character, newChar: Character): Partial<Character> | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const diffs: Record<string, any> = {};

    // 1. Map specific fields based on CHARACTER_FIELD_MAPPINGS
    for (const [frontendKey, backendPath] of Object.entries(CHARACTER_FIELD_MAPPINGS)) {
      const newValue = get(newChar, frontendKey);
      const oldValue = get(oldChar, frontendKey);

      // Only add if the value is present in the update data and different
      if (newValue !== undefined && JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
        set(diffs, backendPath, newValue);
        set(diffs, frontendKey, newValue);
      }
    }

    // 2. Handle 'data' object changes generally (for fields not in mapping but still relevant)
    if (newChar.data) {
      const backendDataPath = 'data';
      const newData = newChar.data;
      const oldData = oldChar.data || {};

      const ignoreKeys = ['extensions']; // Handled via mapping or specific logic

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

  async function saveCharacterOnEditForm(characterData: Character) {
    // Cannot auto-save if we are in creation mode
    if (isCreating.value) {
      // We update the draft state here
      if (draftCharacter.value) {
        Object.assign(draftCharacter.value, characterData);
        // Re-calculate tokens for the draft
        calculateAllTokens(draftCharacter.value);
      }
      return;
    }

    const avatar = uiStore.selectedCharacterAvatarForEditing;
    const character = characters.value.find((c) => c.avatar === avatar);
    if (!avatar || !character) {
      toast.error(t('character.save.noActive'));
      return;
    }

    const changes = getDifferences(character, characterData);

    if (changes) {
      await updateAndSaveCharacter(avatar, changes);

      if ('first_mes' in changes && changes.first_mes !== undefined) {
        if (chatStore.activeChat?.messages.length === 1 && !chatStore.activeChat.messages[0].is_user) {
          const updatedCharacterForGreeting = { ...character, ...characterData } as Character;
          const newFirstMessageDetails = getFirstMessage(updatedCharacterForGreeting);
          if (newFirstMessageDetails) {
            await chatStore.updateMessageObject(0, {
              mes: newFirstMessageDetails.mes,
              swipes: newFirstMessageDetails.swipes,
              swipe_id: newFirstMessageDetails.swipe_id,
              swipe_info: newFirstMessageDetails.swipe_info,
            });
          }
        }
      }
    }
  }

  const saveCharacterDebounced = debounce((characterData: Character) => {
    saveCharacterOnEditForm(characterData);
  }, DEFAULT_SAVE_EDIT_TIMEOUT);

  async function importCharacter(file: File): Promise<string | undefined> {
    if (uiStore.isSendPress) {
      toast.error(t('character.import.abortedMessage'), t('character.import.aborted'));
      throw new Error('Cannot import character while generating');
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['json', 'png'].includes(ext)) {
      toast.warning(t('character.import.unsupportedType', { ext }));
      return;
    }

    try {
      const data = await apiImportCharacter(file);
      if (data.file_name) {
        const avatarFileName = `${data.file_name}.png`;
        toast.success(t('character.import.success', { fileName: data.file_name }));

        await refreshCharacters();
        const importedChar = characters.value.find((c) => c.avatar === avatarFileName);
        if (importedChar) {
          await nextTick();
          await eventEmitter.emit('character:imported', importedChar);
        }

        return avatarFileName;
      }
    } catch (error) {
      console.error('Error importing character', error);
      toast.error(t('character.import.errorMessage'), t('character.import.error'));
      throw error;
    }
  }

  async function importTagsForCharacters(avatarFileNames: string[]) {
    const settingsStore = useSettingsStore();
    if (settingsStore.settings.character.tagImportSetting === 'none') {
      return;
    }
    // TODO: Implement 'ask' setting for tag import.
    // TODO: Implement 'only_existing' setting for tag import.
    for (const avatar of avatarFileNames) {
      const character = characters.value.find((c) => c.avatar === avatar);
      if (character) {
        await handleTagImport(character);
      }
    }
  }

  async function handleTagImport(character: Character) {
    const settingsStore = useSettingsStore();
    const setting = settingsStore.settings.character.tagImportSetting;

    const alreadyAssignedTags = character.tags ?? [];
    const tagsFromCard = (character.tags ?? [])
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !IMPORT_EXLCUDED_TAGS.includes(t))
      .filter((t) => !alreadyAssignedTags.includes(t))
      .slice(0, ANTI_TROLL_MAX_TAGS);

    if (!tagsFromCard.length) return;

    let tagsToImport: string[] = [];

    switch (setting) {
      case 'all':
        tagsToImport = tagsFromCard;
        break;
      case 'ask':
        // TODO: Implement Tag Import Popup
        toast.info(t('character.import.tagImportAskNotImplemented', { characterName: character.name }));
        break;
      case 'only_existing':
        // TODO: Requires global tag list.
        toast.info(t('character.import.tagImportExistingNotImplemented'));
        break;
      case 'none':
      default:
        return;
    }

    if (tagsToImport.length > 0) {
      const newTags = [...alreadyAssignedTags, ...tagsToImport].filter(onlyUnique);
      await updateAndSaveCharacter(character.avatar, { tags: newTags });
      toast.success(
        t('character.import.tagsImportedMessage', { characterName: character.name, tags: tagsToImport.join(', ') }),
        t('character.import.tagsImported'),
        { timeout: 6000 },
      );
    }
  }

  async function highlightCharacter(avatar: string) {
    const charIndex = characters.value.findIndex((c) => c.avatar === avatar);
    if (charIndex === -1) {
      console.warn(`Could not find imported character ${avatar} in the list.`);
      return;
    }

    await selectCharacterByAvatar(avatar);
    highlightedAvatar.value = avatar;

    setTimeout(() => {
      highlightedAvatar.value = null;
    }, 5000);
  }

  function startCreating() {
    // Clear active selection
    uiStore.selectedCharacterAvatarForEditing = null;

    // Set creation mode
    isCreating.value = true;

    // Calculate tokens for empty draft
    calculateAllTokens(draftCharacter.value);
  }

  function cancelCreating() {
    isCreating.value = false;
  }

  async function createNewCharacter(character: Character, file?: File) {
    if (uiStore.isSendPress) {
      toast.error(t('character.import.abortedMessage'));
      return;
    }

    const formData = new FormData();
    // Basic fields
    formData.append('ch_name', character.name);
    if (file) {
      formData.append('avatar', file);
    }
    formData.append('fav', String(character.fav || false));
    formData.append('description', character.description || '');
    formData.append('first_mes', character.first_mes || '');

    // Empty fields for compatibility with SillyTavern backend
    formData.append('json_data', '');
    formData.append('avatar_url', '');
    formData.append('chat', '');
    formData.append('create_date', '');
    formData.append('last_mes', '');
    formData.append('world', '');

    // Advanced fields
    formData.append('system_prompt', character.data?.system_prompt || '');
    formData.append('post_history_instructions', character.data?.post_history_instructions || '');
    formData.append('creator', character.data?.creator || '');
    formData.append('character_version', character.data?.character_version || '');
    formData.append('creator_notes', character.data?.creator_notes || '');
    formData.append('tags', (character.tags || []).join(','));
    formData.append('personality', character.personality || '');
    formData.append('scenario', character.scenario || '');

    // Depth Prompt (Flattened structure)
    formData.append('depth_prompt_prompt', character.data?.depth_prompt?.prompt || '');
    formData.append('depth_prompt_depth', String(character.data?.depth_prompt?.depth ?? depth_prompt_depth_default));
    formData.append('depth_prompt_role', character.data?.depth_prompt?.role || depth_prompt_role_default);

    formData.append('talkativeness', String(character.talkativeness ?? talkativeness_default));
    formData.append('mes_example', character.mes_example || '');
    formData.append('extensions', JSON.stringify({}));

    try {
      const result = await apiCreateCharacter(formData);

      if (result && result.file_name) {
        toast.success(t('character.create.success', { name: character.name }));

        await refreshCharacters();

        const newCharIndex = characters.value.findIndex((c) => c.avatar === result.file_name);
        if (newCharIndex !== -1) {
          isCreating.value = false;
          draftCharacter.value = DEFAULT_CHARACTER;
          await selectCharacterByAvatar(result.file_name);
          const createdChar = characters.value[newCharIndex];
          await nextTick();
          await eventEmitter.emit('character:created', createdChar);
          await highlightCharacter(createdChar.avatar);
        }
      }
    } catch (error) {
      console.error('Failed to create new character:', error);
      toast.error(t('character.create.error'));
    }
  }

  async function deleteCharacter(avatar: string, deleteChats: boolean) {
    try {
      const charName = characters.value.find((c) => c.avatar === avatar)?.name || avatar;

      await apiDeleteCharacter(avatar, deleteChats);

      // Delete chat is not going to work for root chats, so we handle it here
      const isThereOnlyCharacter =
        chatStore.activeChat?.metadata.members?.length === 1 && chatStore.activeChat.metadata.members[0] === avatar;
      if (isThereOnlyCharacter) {
        await chatStore.clearChat();
        chatStore.activeChat = null;
      }

      const index = characters.value.findIndex((c) => c.avatar === avatar);
      if (index !== -1) {
        characters.value.splice(index, 1);
      }

      uiStore.selectedCharacterAvatarForEditing = null;

      toast.success(t('character.delete.success', { name: charName }));
      await nextTick();
      await eventEmitter.emit('character:deleted', avatar);
    } catch (error) {
      console.error('Failed to delete character:', error);
      toast.error(t('character.delete.error'));
    }
  }

  async function updateCharacterImage(avatar: string, imageFile: File) {
    try {
      await apiUpdateCharacterImage(avatar, imageFile);
      const character = characters.value.find((c) => c.avatar === avatar);
      if (character) {
        // Force refresh
        character.avatar = character.avatar;
      }
      await refreshCharacters();
    } catch (error) {
      console.error('Failed to update character image:', error);
      toast.error(t('character.updateImage.error'));
    }
  }

  async function duplicateCharacter(avatar: string) {
    const character = characters.value.find((c) => c.avatar === avatar);
    if (!character) return;

    const charCopy = { ...character, name: character.name };

    charCopy.chat = `${character.name} - ${humanizedDateTime()}`;
    delete charCopy.create_date;

    try {
      const url = getThumbnailUrl('avatar', avatar);
      const res = await fetch(url);
      const blob = await res.blob();
      const file = new File([blob], 'avatar.png', { type: blob.type });

      await createNewCharacter(charCopy, file);
    } catch (error) {
      console.error('Failed to duplicate character', error);
      toast.error(t('character.duplicate.error'));
    }
  }

  return {
    characters,
    activeCharacters,
    activeCharacterAvatars,
    favoriteCharacterChecked,
    displayableCharacters,
    paginatedCharacters,
    currentPage,
    itemsPerPage,
    searchTerm,
    sortOrder,
    isCreating,
    draftCharacter,
    editFormCharacter,
    refreshCharacters,
    selectCharacterByAvatar,
    saveCharacterOnEditForm,
    refreshCharactersDebounced,
    saveCharacterDebounced,
    tokenCounts,
    totalTokens,
    permanentTokens,
    calculateAllTokens,
    importCharacter,
    importTagsForCharacters,
    highlightedAvatar,
    highlightCharacter,
    startCreating,
    cancelCreating,
    createNewCharacter,
    deleteCharacter,
    updateCharacterImage,
    updateAndSaveCharacter,
    duplicateCharacter,
  };
});
