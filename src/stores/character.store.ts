import { defineStore } from 'pinia';
import { ref, computed, nextTick } from 'vue';
import type { Character, Entity } from '../types';
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
import { useGroupStore } from './group.store';
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
import { get, set, defaultsDeep, debounce } from 'lodash-es';
import { eventEmitter } from '../utils/event-emitter';
import { ApiTokenizer } from '../api/tokenizer';

const ANTI_TROLL_MAX_TAGS = 50;
const IMPORT_EXLCUDED_TAGS: string[] = [];
const CHARACTER_SORT_ORDER_KEY = 'character_sort_order';

export const useCharacterStore = defineStore('character', () => {
  const { t } = useStrictI18n();
  const settingsStore = useSettingsStore();
  const characters = ref<Array<Character>>([]);
  const activeCharacterIndex = ref<number | null>(null);
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
    get: () => settingsStore.getAccountItem(CHARACTER_SORT_ORDER_KEY) ?? 'name:asc',
    set: (value) => settingsStore.setAccountItem(CHARACTER_SORT_ORDER_KEY, value),
  });

  const isCreating = ref(false);
  const draftCharacter = ref<Character | null>(null);

  const activeCharacter = computed<Character | null>(() => {
    if (isCreating.value && draftCharacter.value) {
      return draftCharacter.value;
    }
    if (activeCharacterIndex.value !== null && characters.value[activeCharacterIndex.value]) {
      return characters.value[activeCharacterIndex.value];
    }
    return null;
  });

  const activeCharacterName = computed<string | null>(() => activeCharacter.value?.name ?? null);
  const totalTokens = computed(() => tokenCounts.value.total);
  const permanentTokens = computed(() => tokenCounts.value.permanent);

  const displayableEntities = computed<Entity[]>(() => {
    const groupStore = useGroupStore();

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

    const characterEntities: Entity[] = sortedCharacters.map((char) => ({
      item: char,
      // Find original index to use as a stable ID for selection
      id: characters.value.findIndex((originalChar) => originalChar.avatar === char.avatar),
      type: 'character',
    }));

    // TODO: Implement group filtering and sorting
    const groupEntities: Entity[] = groupStore.groups.map((group) => ({
      item: group,
      id: group.id,
      type: 'group',
    }));

    return [...characterEntities, ...groupEntities];
  });

  const paginatedEntities = computed<Entity[]>(() => {
    const totalItems = displayableEntities.value.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage.value);

    if (currentPage.value > totalPages && totalPages > 0) {
      currentPage.value = totalPages;
    }

    const start = (currentPage.value - 1) * itemsPerPage.value;
    const end = start + itemsPerPage.value;
    return displayableEntities.value.slice(start, end);
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
      const previousAvatar = !isCreating.value ? activeCharacter.value?.avatar : null;

      for (const char of newCharacters) {
        char.name = DOMPurify.sanitize(char.name);
        if (!char.chat) {
          char.chat = `${char.name} - ${humanizedDateTime()}`;
        }
        char.chat = String(char.chat);
      }

      characters.value = newCharacters;

      if (previousAvatar) {
        const newIndex = characters.value.findIndex((c) => c.avatar === previousAvatar);
        if (newIndex !== -1) {
          activeCharacterIndex.value = newIndex;
        } else {
          toast.error(t('character.fetch.error'));
          activeCharacterIndex.value = null;
        }
      }
      // TODO: refreshGroups()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Failed to fetch characters:', error);
      if (error.message === 'overflow') {
        toast.warning(t('character.fetch.overflowWarning'));
      }
    }
  }

  async function selectCharacterById(index: number) {
    if (characters.value[index] === undefined) return;

    // If we were creating, cancel it
    if (isCreating.value) {
      cancelCreating();
    }

    const uiStore = useUiStore();
    if (uiStore.isChatSaving) {
      toast.info(t('character.switch.wait'));
      return;
    }
    // TODO: Add group logic checks
    if (activeCharacterIndex.value !== index) {
      const chatStore = useChatStore();
      await chatStore.clearChat();
      // TODO: resetSelectedGroup();
      activeCharacterIndex.value = index;
      await chatStore.setActiveChatFile(activeCharacter.value!.chat!);
    }
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

  async function saveActiveCharacter(characterData: Partial<Character>) {
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

    const avatar = activeCharacter.value?.avatar;
    if (!avatar || !activeCharacter.value) {
      toast.error(t('character.save.noActive'));
      return;
    }

    const oldCharacter = activeCharacter.value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes: Record<string, any> = {};

    // 1. Map specific fields based on CHARACTER_FIELD_MAPPINGS
    for (const [frontendKey, backendPath] of Object.entries(CHARACTER_FIELD_MAPPINGS)) {
      const newValue = get(characterData, frontendKey);
      const oldValue = get(oldCharacter, frontendKey);

      // Only add if the value is present in the update data and different
      if (newValue !== undefined && JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
        set(changes, backendPath, newValue);
        set(changes, frontendKey, newValue);
      }
    }

    // 2. Handle 'data' object changes generally (for fields not in mapping but still relevant)
    if (characterData.data) {
      const backendDataPath = 'data';
      const newData = characterData.data;
      const oldData = oldCharacter.data || {};

      const ignoreKeys = ['extensions']; // Handled via mapping or specific logic

      for (const key in newData) {
        if (ignoreKeys.includes(key)) continue;

        const newSubValue = newData[key];
        const oldSubValue = oldData[key];

        if (JSON.stringify(newSubValue) !== JSON.stringify(oldSubValue)) {
          set(changes, `${backendDataPath}.${key}`, newSubValue);
        }
      }
    }

    if (Object.keys(changes).length > 0) {
      await updateAndSaveCharacter(avatar, changes);

      if ('first_mes' in changes && changes.first_mes !== undefined) {
        const chatStore = useChatStore();
        if (chatStore.chat.length === 1 && !chatStore.chat[0].is_user) {
          const updatedCharacterForGreeting = { ...activeCharacter.value, ...characterData } as Character;
          const newFirstMessageDetails = getFirstMessage(updatedCharacterForGreeting);
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

  const saveCharacterDebounced = debounce((characterData: Partial<Character>) => {
    saveActiveCharacter(characterData);
  }, DEFAULT_SAVE_EDIT_TIMEOUT);

  async function importCharacter(file: File): Promise<string | undefined> {
    const uiStore = useUiStore();
    const groupStore = useGroupStore();
    if (groupStore.isGroupGenerating || uiStore.isSendPress) {
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

  async function highlightCharacter(avatarFileName: string) {
    const charIndex = characters.value.findIndex((c) => c.avatar === avatarFileName);
    if (charIndex === -1) {
      console.warn(`Could not find imported character ${avatarFileName} in the list.`);
      return;
    }

    await selectCharacterById(charIndex);
    highlightedAvatar.value = avatarFileName;

    setTimeout(() => {
      highlightedAvatar.value = null;
    }, 5000);
  }

  function startCreating() {
    // Clear active selection
    activeCharacterIndex.value = null;

    // Prepare draft with defaults
    draftCharacter.value = defaultsDeep({}, DEFAULT_CHARACTER) as Character;

    // Set creation mode
    isCreating.value = true;

    // Calculate tokens for empty draft
    calculateAllTokens(draftCharacter.value);
  }

  function cancelCreating() {
    isCreating.value = false;
    draftCharacter.value = null;
  }

  async function createNewCharacter(character: Character, file?: File) {
    const uiStore = useUiStore();
    const groupStore = useGroupStore();

    if (groupStore.isGroupGenerating || uiStore.isSendPress) {
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
          draftCharacter.value = null;
          await selectCharacterById(newCharIndex);
          const createdChar = characters.value[newCharIndex];
          await nextTick();
          await eventEmitter.emit('character:created', createdChar);
          highlightCharacter(createdChar.avatar);
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

      if (activeCharacter.value?.avatar === avatar) {
        const chatStore = useChatStore();
        await chatStore.clearChat();
      }

      await apiDeleteCharacter(avatar, deleteChats);

      const index = characters.value.findIndex((c) => c.avatar === avatar);
      if (index !== -1) {
        characters.value.splice(index, 1);
      }

      if (activeCharacterIndex.value !== null && characters.value.length > 0) {
        if (activeCharacterIndex.value >= characters.value.length) {
          activeCharacterIndex.value = null;
        }
      }

      activeCharacterIndex.value = null;

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

  return {
    characters,
    activeCharacterIndex,
    favoriteCharacterChecked,
    activeCharacter,
    activeCharacterName,
    displayableEntities,
    paginatedEntities,
    currentPage,
    itemsPerPage,
    searchTerm,
    sortOrder,
    isCreating,
    draftCharacter,
    refreshCharacters,
    selectCharacterById,
    saveActiveCharacter,
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
  };
});
