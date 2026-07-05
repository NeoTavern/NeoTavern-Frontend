import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { usePersonaStore } from './persona.store';
import { useSettingsStore } from './settings.store';

export const usePersonaUiStore = defineStore('persona-ui', () => {
  const personaStore = usePersonaStore();
  const settingsStore = useSettingsStore();

  const searchTerm = ref('');
  const sortOrder = ref('asc');
  const viewMode = ref<'editor' | 'settings'>('editor');
  const isGridView = ref(false);
  const itemsPerPage = computed({
    get: () => settingsStore.settings.account.personaPageSize ?? 10,
    set: (value) => (settingsStore.settings.account.personaPageSize = value),
  });

  const filteredPersonas = computed(() => {
    let list = [...personaStore.personas];

    if (searchTerm.value) {
      const lowerSearch = searchTerm.value.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(lowerSearch) || (p.description || '').toLowerCase().includes(lowerSearch),
      );
    }

    list.sort((a, b) => {
      if (sortOrder.value === 'asc') return a.name.localeCompare(b.name);
      return b.name.localeCompare(a.name);
    });

    return list;
  });

  const isBrowserExpanded = computed({
    get: () => settingsStore.settings.account.personaBrowserExpanded,
    set: (val) => (settingsStore.settings.account.personaBrowserExpanded = val),
  });

  return {
    searchTerm,
    sortOrder,
    viewMode,
    isGridView,
    itemsPerPage,
    filteredPersonas,
    isBrowserExpanded,
  };
});
