import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Character, Entity } from '../types';
import { fetchAllCharacters } from '../api/characters';
import DOMPurify from 'dompurify';
import { humanizedDateTime } from '../utils/date';
import { toast } from '../composables/useToast';
import { useChatStore } from './chat.store';
import { useGroupStore } from './group.store';
import { useUiStore } from './ui.store';

export const useCharacterStore = defineStore('character', () => {
  const characters = ref<Array<Character>>([]);
  const activeCharacterIndex = ref<number | null>(null);
  const favoriteCharacterChecked = ref<boolean>(false);

  const activeCharacter = computed<Character | null>(() => {
    if (activeCharacterIndex.value !== null && characters.value[activeCharacterIndex.value]) {
      return characters.value[activeCharacterIndex.value];
    }
    return null;
  });

  const activeCharacterName = computed<string | null>(() => activeCharacter.value?.name ?? null);

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
          await selectCharacterById(newIndex, { switchMenu: false });
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

  return {
    characters,
    activeCharacterIndex,
    favoriteCharacterChecked,
    activeCharacter,
    activeCharacterName,
    displayableEntities,
    refreshCharacters,
    selectCharacterById,
  };
});
