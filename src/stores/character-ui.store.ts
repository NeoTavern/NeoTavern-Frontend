import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { DEFAULT_CHARACTER } from '../constants';
import { type Character } from '../types';
import { filterAndSortCharacters } from '../utils/character';
import { useCharacterStore } from './character.store';
import { useSettingsStore } from './settings.store';
import { useTagStore } from './tag.store';

export const useCharacterUiStore = defineStore('character-ui', () => {
  const characterStore = useCharacterStore();
  const settingsStore = useSettingsStore();
  const tagStore = useTagStore();

  const currentPage = ref(1);
  const itemsPerPage = ref(25);
  const highlightedAvatar = ref<string | null>(null);
  const searchTerm = ref('');
  const filterTags = ref<string[]>([]);
  const isCreating = ref(false);
  const draftCharacter = ref<Character>(DEFAULT_CHARACTER);
  const selectedCharacterAvatarForEditing = ref<string | null>(null);

  const sortOrder = computed({
    get: () => settingsStore.settings.account.characterSortOrder ?? 'name:asc',
    set: (value) => (settingsStore.settings.account.characterSortOrder = value),
  });

  const availableTags = computed<string[]>(() => {
    const tags = new Set<string>();
    if (!settingsStore.settings.character.hideEmbeddedTagsInSuggestions) {
      characterStore.characters.forEach((char) => {
        char.tags?.forEach((tag) => tags.add(tag));
      });
    }
    tagStore.customTags.forEach((tag) => tags.add(tag.name));
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  });

  const displayableCharacters = computed<Character[]>(() => {
    return filterAndSortCharacters(
      characterStore.characters,
      searchTerm.value,
      filterTags.value,
      sortOrder.value,
      tagStore.getCustomTagsForCharacter,
    );
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

  const editFormCharacter = computed<Character | null>(() => {
    if (isCreating.value) {
      return draftCharacter.value;
    }

    if (selectedCharacterAvatarForEditing.value) {
      const editingCharacter = characterStore.characters.find(
        (char) => char.avatar === selectedCharacterAvatarForEditing.value,
      );
      if (editingCharacter) {
        return editingCharacter;
      }
    }

    return null;
  });

  function startCreating() {
    selectedCharacterAvatarForEditing.value = null;
    isCreating.value = true;
  }

  function cancelCreating() {
    isCreating.value = false;
  }

  function selectCharacterByAvatar(avatar: string) {
    const character = characterStore.characters.find((c) => c.avatar === avatar);
    if (!character) return;

    if (isCreating.value) {
      cancelCreating();
    }
    selectedCharacterAvatarForEditing.value = avatar;
  }

  function highlightCharacter(avatar: string) {
    const charIndex = characterStore.characters.findIndex((c) => c.avatar === avatar);
    if (charIndex === -1) {
      console.warn(`Could not find character ${avatar} to highlight.`);
      return;
    }

    selectCharacterByAvatar(avatar);
    highlightedAvatar.value = avatar;

    setTimeout(() => {
      highlightedAvatar.value = null;
    }, 5000);
  }

  return {
    currentPage,
    itemsPerPage,
    highlightedAvatar,
    searchTerm,
    filterTags,
    availableTags,
    isCreating,
    draftCharacter,
    selectedCharacterAvatarForEditing,
    sortOrder,
    displayableCharacters,
    paginatedCharacters,
    editFormCharacter,
    tagStore,
    startCreating,
    cancelCreating,
    selectCharacterByAvatar,
    highlightCharacter,
  };
});
