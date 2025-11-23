import { defineStore } from 'pinia';
import { ref, computed, nextTick } from 'vue';
import { type Character, POPUP_RESULT, POPUP_TYPE } from '../types';
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
import { toast } from '../composables/useToast';
import { useChatStore } from './chat.store';
import { useUiStore } from './ui.store';
import { usePopupStore } from './popup.store';
import { useWorldInfoStore } from './world-info.store';
import { useCharacterTokens } from '../composables/useCharacterTokens';
import { DEFAULT_CHARACTER, DEFAULT_PRINT_TIMEOUT, DEFAULT_SAVE_EDIT_TIMEOUT } from '../constants';
import { useSettingsStore } from './settings.store';
import { onlyUnique } from '../utils/array';
import { useStrictI18n } from '../composables/useStrictI18n';
import { getFirstMessage } from '../utils/chat';
import { debounce } from 'lodash-es';
import { eventEmitter } from '../utils/event-emitter';
import { getThumbnailUrl } from '../utils/image';
import { convertCharacterBookToWorldInfoBook } from '../utils/world-info-conversion';
import { uuidv4 } from '../utils/common';
import {
  getCharacterDifferences,
  createCharacterFormData,
  filterAndSortCharacters,
} from '../utils/character-manipulation';

const ANTI_TROLL_MAX_TAGS = 50;
const IMPORT_EXLCUDED_TAGS: string[] = [];

export const useCharacterStore = defineStore('character', () => {
  const { t } = useStrictI18n();
  const settingsStore = useSettingsStore();
  const chatStore = useChatStore();
  const uiStore = useUiStore();
  const popupStore = usePopupStore();
  const worldInfoStore = useWorldInfoStore();

  const { tokenCounts, totalTokens, permanentTokens, calculateAllTokens } = useCharacterTokens();

  const characters = ref<Array<Character>>([]);
  const favoriteCharacterChecked = ref<boolean>(false);
  const currentPage = ref(1);
  const itemsPerPage = ref(25);
  const highlightedAvatar = ref<string | null>(null);
  const searchTerm = ref('');
  const isCreating = ref(false);
  const draftCharacter = ref<Character>(DEFAULT_CHARACTER);

  const sortOrder = computed({
    get: () => settingsStore.settings.account.characterSortOrder ?? 'name:asc',
    set: (value) => (settingsStore.settings.account.characterSortOrder = value),
  });

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

  const displayableCharacters = computed<Character[]>(() => {
    return filterAndSortCharacters(characters.value, searchTerm.value, sortOrder.value);
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

  async function refreshCharacters() {
    try {
      const newCharacters = await fetchAllCharacters();

      for (const char of newCharacters) {
        char.name = DOMPurify.sanitize(char.name);
        if (!char.chat) {
          char.chat = uuidv4();
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
        console.warn(`Saved character with avatar ${avatar} not found in local list. Refreshing list.`);
        await refreshCharacters();
      }
    } catch (error) {
      console.error('Failed to save character:', error);
      toast.error(t('character.save.error'));
    }
  }

  async function renameCharacter(avatar: string, newName: string) {
    const character = characters.value.find((c) => c.avatar === avatar);
    if (!character) return;
    const changes = getCharacterDifferences(character, { ...character, name: newName });
    if (!changes) return;
    await updateAndSaveCharacter(avatar, changes);
    toast.success(t('character.rename.success', { name: newName }));
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

    const changes = getCharacterDifferences(character, characterData);

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
      // Generate UUID for filename
      const uuid = uuidv4();
      const newFileName = `${uuid}.${ext}`;
      const renamedFile = new File([file], newFileName, { type: file.type });

      const data = await apiImportCharacter(renamedFile);
      if (data.file_name) {
        const avatarFileName = `${data.file_name}.png`;
        toast.success(t('character.import.success', { fileName: data.file_name }));

        await refreshCharacters();
        const importedChar = characters.value.find((c) => c.avatar === avatarFileName);
        if (importedChar) {
          await nextTick();
          await eventEmitter.emit('character:imported', importedChar);

          // Check for embedded lorebook
          if (importedChar.data?.character_book) {
            const bookName = importedChar.data.character_book.name || importedChar.name;
            const { result } = await popupStore.show({
              title: t('worldInfo.popup.importEmbeddedTitle'),
              content: t('worldInfo.popup.importEmbeddedContent', { name: bookName }),
              type: POPUP_TYPE.CONFIRM,
            });

            if (result === POPUP_RESULT.AFFIRMATIVE) {
              await worldInfoStore.createNewBook({
                filename: uuidv4(),
                book: convertCharacterBookToWorldInfoBook(importedChar.data.character_book),
              });
              toast.success(t('worldInfo.importSuccess', { name: bookName }));
            }
          }
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
      const changes = getCharacterDifferences(character, { ...character, tags: newTags });
      if (!changes) return;
      await updateAndSaveCharacter(character.avatar, changes);
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

    const uuid = uuidv4();
    const fileName = `${uuid}.png`;
    const fileToSend = file ? new File([file], fileName, { type: file.type }) : null;

    const formData = createCharacterFormData(character, fileToSend, uuid);

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

    const uuid = uuidv4();
    charCopy.chat = uuid;
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

  const getDifferences = getCharacterDifferences;

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
    renameCharacter,
    getDifferences,
    deleteCharacter,
    updateCharacterImage,
    updateAndSaveCharacter,
    duplicateCharacter,
  };
});
