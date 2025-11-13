import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Character, Entity } from '../types';
import { fetchAllCharacters, saveCharacter, fetchCharacterByAvatar } from '../api/characters';
import DOMPurify from 'dompurify';
import { humanizedDateTime } from '../utils/date';
import { toast } from '../composables/useToast';
import { useChatStore } from './chat.store';
import { useGroupStore } from './group.store';
import { useUiStore } from './ui.store';
import { debounce } from '../utils/common';
import { DEFAULT_PRINT_TIMEOUT, DEFAULT_SAVE_EDIT_TIMEOUT, DebounceTimeout } from '../constants';

// TODO: Replace with a real API call to the backend for accurate tokenization
async function getTokenCount(text: string): Promise<number> {
  if (!text || typeof text !== 'string') return 0;
  // This is a very rough approximation. The backend will have a proper tokenizer.
  return Math.round(text.length / 4);
}

export const useCharacterStore = defineStore('character', () => {
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
          toast.error('The active character is no longer available. The page will be refreshed to prevent data loss.');
          setTimeout(() => location.reload(), 3000);
        }
      }
      // TODO: refreshGroups()
    } catch (error: any) {
      console.error('Failed to fetch characters:', error);
      if (error.message === 'overflow') {
        toast.warning(
          'Character data length limit reached. To resolve this, set "performance.lazyLoadCharacters" to "true" in config.yaml and restart the server.',
        );
      }
    }
  }

  async function selectCharacterById(index: number, { switchMenu = true } = {}) {
    if (characters.value[index] === undefined) return;

    const uiStore = useUiStore();
    if (uiStore.isChatSaving) {
      toast.info('Please wait until the chat is saved before switching characters.');
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

  async function saveActiveCharacter(characterData: Partial<Character>) {
    const avatar = activeCharacter.value?.avatar;
    if (!avatar || !activeCharacter.value) {
      toast.error('Cannot save character: No active character or avatar found.');
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

    if (Object.keys(changes).length === 0) {
      return;
    }

    // Ensure the `avatar` property (which is the filename) is included for the API call.
    const dataToSave = {
      ...changes,
      avatar: avatar,
    };

    try {
      await saveCharacter(dataToSave);

      // After saving, fetch the updated character data to ensure consistency.
      const updatedCharacter = await fetchCharacterByAvatar(avatar);
      updatedCharacter.name = DOMPurify.sanitize(updatedCharacter.name);

      if (activeCharacterIndex.value !== null) {
        characters.value[activeCharacterIndex.value] = updatedCharacter;
      } else {
        // This case should ideally not happen if a character is active, but as a fallback:
        const index = characters.value.findIndex((c) => c.avatar === avatar);
        if (index !== -1) {
          characters.value[index] = updatedCharacter;
        } else {
          // If character is somehow not in the list, we might need to refresh entirely.
          // For now, log an error.
          console.error(`Saved character with avatar ${avatar} not found in local list.`);
          toast.warning('Character saved, but local list might be out of sync. Consider refreshing.');
        }
      }

      // TODO: Update character list if we changed tag or something.
    } catch (error) {
      console.error('Failed to save character:', error);
      toast.error('Failed to save character.');
    }
  }

  const saveCharacterDebounced = debounce((characterData: Partial<Character>) => {
    saveActiveCharacter(characterData);
  }, DEFAULT_SAVE_EDIT_TIMEOUT);

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
  };
});
