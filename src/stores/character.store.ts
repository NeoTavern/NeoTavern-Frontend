import { defineStore } from 'pinia';
import { ref, computed, nextTick } from 'vue';
import type { Character, Entity } from '../types';
import {
  fetchAllCharacters,
  saveCharacter,
  fetchCharacterByAvatar,
  importCharacter as apiImportCharacter,
} from '../api/characters';
import DOMPurify from 'dompurify';
import { humanizedDateTime } from '../utils/date';
import { toast } from '../composables/useToast';
import { useChatStore } from './chat.store';
import { useGroupStore } from './group.store';
import { useUiStore } from './ui.store';
import { debounce } from '../utils/common';
import { DEFAULT_PRINT_TIMEOUT, DEFAULT_SAVE_EDIT_TIMEOUT, DebounceTimeout } from '../constants';
import { useSettingsStore } from './settings.store';
import { onlyUnique } from '../utils/array';
import i18n from '../i18n';
import { getFirstMessage } from '../utils/chat';

// TODO: Replace with a real API call to the backend for accurate tokenization
async function getTokenCount(text: string): Promise<number> {
  if (!text || typeof text !== 'string') return 0;
  // This is a very rough approximation. The backend will have a proper tokenizer.
  return Math.round(text.length / 4);
}

const ANTI_TROLL_MAX_TAGS = 50;
const IMPORT_EXLCUDED_TAGS: string[] = [];

export const useCharacterStore = defineStore('character', () => {
  const { t } = i18n.global;
  const characters = ref<Array<Character>>([]);
  const activeCharacterIndex = ref<number | null>(null);
  const favoriteCharacterChecked = ref<boolean>(false);
  const tokenCounts = ref<{ total: number; permanent: number; fields: Record<string, number> }>({
    total: 0,
    permanent: 0,
    fields: {},
  });

  const activeCharacter = computed<Character | null>(() => {
    if (activeCharacterIndex.value !== null && characters.value[activeCharacterIndex.value]) {
      return characters.value[activeCharacterIndex.value];
    }
    return null;
  });

  const activeCharacterName = computed<string | null>(() => activeCharacter.value?.name ?? null);
  const totalTokens = computed(() => tokenCounts.value.total);
  const permanentTokens = computed(() => tokenCounts.value.permanent);

  const displayableEntities = computed<Entity[]>(() => {
    // This is the reactive equivalent of the old `getEntitiesList` function
    const groupStore = useGroupStore();

    const characterEntities: Entity[] = characters.value.map((char, index) => ({
      item: char,
      id: index, // Using index as ID for selection
      type: 'character',
    }));

    const groupEntities: Entity[] = groupStore.groups.map((group) => ({
      item: group,
      id: group.id,
      type: 'group',
    }));

    // TODO: Add sorting and filtering logic here
    return [...characterEntities, ...groupEntities];
  });

  const refreshCharactersDebounced = debounce(() => {
    refreshCharacters();
  }, DEFAULT_PRINT_TIMEOUT);

  // Helper to safely get a nested property
  function getNestedValue(obj: any, path: string): string {
    if (!obj) return '';
    const value = path.split('.').reduce((o, p) => (o ? o[p] : undefined), obj);
    return typeof value === 'string' ? value : '';
  }

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

    const newFieldCounts: Record<string, number> = {};
    const promises = fieldPaths.map((path) =>
      getTokenCount(getNestedValue(characterData, path)).then((count) => {
        newFieldCounts[path] = count;
      }),
    );

    await Promise.all(promises);

    const total = Object.values(newFieldCounts).reduce((sum, count) => sum + count, 0);

    // In the context of the character editor, all definition tokens are considered permanent.
    tokenCounts.value = {
      total: total,
      permanent: total,
      fields: newFieldCounts,
    };
  }, DebounceTimeout.RELAXED);

  async function refreshCharacters() {
    try {
      const newCharacters = await fetchAllCharacters();
      const previousAvatar = activeCharacter.value?.avatar;

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
          if (activeCharacterIndex.value !== newIndex) {
            await selectCharacterById(newIndex, { switchMenu: false });
          }
        } else {
          toast.error(t('character.fetch.error'));
          setTimeout(() => location.reload(), 3000);
        }
      }
      // TODO: refreshGroups()
    } catch (error: any) {
      console.error('Failed to fetch characters:', error);
      if (error.message === 'overflow') {
        toast.warning(t('character.fetch.overflowWarning'));
      }
    }
  }

  async function selectCharacterById(index: number, { switchMenu = true } = {}) {
    if (characters.value[index] === undefined) return;

    const uiStore = useUiStore();
    if (uiStore.isChatSaving) {
      toast.info(t('character.switch.wait'));
      return;
    }

    // TODO: Add group logic checks

    if (activeCharacterIndex.value !== index) {
      if (!uiStore.isSendPress) {
        const chatStore = useChatStore();
        await chatStore.clearChat();

        // TODO: resetSelectedGroup();
        uiStore.selectedButton = 'character_edit';
        uiStore.menuType = 'character_edit';
        activeCharacterIndex.value = index;

        await chatStore.refreshChat();
      }
    } else {
      // Clicked on already selected character
      if (switchMenu) {
        uiStore.selectedButton = 'character_edit';
        uiStore.menuType = 'character_edit';
      }
      // TODO: Unshallow character logic
      // TODO: select_selected_character logic to populate editor form
    }
  }

  async function updateAndSaveCharacter(avatar: string, changes: Partial<Character>) {
    if (Object.keys(changes).length === 0) return;

    const dataToSave = { ...changes, avatar };
    try {
      await saveCharacter(dataToSave);

      const updatedCharacter = await fetchCharacterByAvatar(avatar);
      updatedCharacter.name = DOMPurify.sanitize(updatedCharacter.name);

      const index = characters.value.findIndex((c) => c.avatar === avatar);
      if (index !== -1) {
        characters.value[index] = updatedCharacter;
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
    const avatar = activeCharacter.value?.avatar;
    if (!avatar || !activeCharacter.value) {
      toast.error(t('character.save.noActive'));
      console.error('Attempted to save character without an active character reference.');
      return;
    }

    const oldCharacter = activeCharacter.value;
    const changes: Partial<Character> & { data?: any } = {};

    for (const key in characterData) {
      const typedKey = key as keyof Character;
      const newValue = characterData[typedKey];
      const oldValue = oldCharacter[typedKey];

      if (typedKey === 'data') {
        // Handle 'data' object with a granular diff
        const dataChanges: Record<string, any> = {};
        const newData = (newValue || {}) as Record<string, any>;
        const oldData = (oldValue || {}) as Record<string, any>;

        // Check all keys from both old and new data to catch additions, changes, and removals
        const allDataKeys = new Set([...Object.keys(newData), ...Object.keys(oldData)]);

        for (const subKey of allDataKeys) {
          const newSubValue = newData[subKey];
          const oldSubValue = oldData[subKey];

          // Special handling for 'extensions' objects, which is similar to 'data'
          if (subKey === 'extensions') {
            const newExt = (newSubValue || {}) as Record<string, any>;
            const oldExt = (oldSubValue || {}) as Record<string, any>;

            const allExtKeys = new Set([...Object.keys(newExt), ...Object.keys(oldExt)]);

            for (const extKey of allExtKeys) {
              const newExtValue = newExt[extKey];
              const oldExtValue = oldExt[extKey];

              if (JSON.stringify(newExtValue) !== JSON.stringify(oldExtValue)) {
                dataChanges[subKey] = dataChanges[subKey] || {};
                dataChanges[subKey][extKey] = newExtValue;
              }
            }
            continue;
          }

          // A robust stringify comparison handles primitives, arrays, and nested objects within 'data'.
          if (JSON.stringify(newSubValue) !== JSON.stringify(oldSubValue)) {
            dataChanges[subKey] = newSubValue;
          }
        }

        if (Object.keys(dataChanges).length > 0) {
          changes.data = dataChanges;
        }
      } else {
        // Handle all other top-level properties (including arrays like 'tags')
        if (JSON.stringify(newValue) !== JSON.stringify(oldValue)) {
          // @ts-ignore - This is safe because we're iterating over keys of characterData
          changes[typedKey] = newValue;
        }
      }
    }

    if (Object.keys(changes).length > 0) {
      await updateAndSaveCharacter(avatar, changes);

      if ('first_mes' in changes && changes.first_mes !== undefined) {
        const chatStore = useChatStore();

        if (chatStore.chat.length === 1 && chatStore.chat[0] && !chatStore.chat[0].is_user) {
          const currentMessage = chatStore.chat[0];
          // Use a fresh copy of the character with the latest changes applied
          const updatedCharacterForGreeting = { ...activeCharacter.value, ...changes } as Character;

          // Re-evaluate the first message details, including swipes
          const newFirstMessageDetails = getFirstMessage(updatedCharacterForGreeting);

          currentMessage.mes = newFirstMessageDetails.mes;
          currentMessage.swipes = newFirstMessageDetails.swipes;
          currentMessage.swipe_id = newFirstMessageDetails.swipe_id;
          currentMessage.swipe_info = newFirstMessageDetails.swipe_info;

          await chatStore.saveChat();
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
    if (settingsStore.powerUser.tag_import_setting === 'none') {
      return;
    }

    for (const avatar of avatarFileNames) {
      const character = characters.value.find((c) => c.avatar === avatar);
      if (character) {
        await handleTagImport(character);
      }
    }
  }

  async function handleTagImport(character: Character) {
    const settingsStore = useSettingsStore();
    const setting = settingsStore.powerUser.tag_import_setting;

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
        {
          timeout: 6000,
        },
      );
    }
  }

  async function highlightCharacter(avatarFileName: string) {
    const uiStore = useUiStore();
    uiStore.menuType = 'characters';
    await nextTick();

    const charIndex = characters.value.findIndex((c) => c.avatar === avatarFileName);
    if (charIndex === -1) {
      console.warn(`Could not find imported character ${avatarFileName} in the list.`);
      return;
    }

    const element = document.querySelector(`.character-item[data-avatar="${avatarFileName}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('flash', 'animated');
      setTimeout(() => {
        element.classList.remove('flash', 'animated');
      }, 5000);
    }
  }

  return {
    characters,
    activeCharacterIndex,
    favoriteCharacterChecked,
    activeCharacter,
    activeCharacterName,
    displayableEntities,
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
    highlightCharacter,
  };
});
