import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useSettingsStore } from './settings.store';
import {
  type WorldInfoBook,
  type WorldInfoSettings,
  WorldInfoInsertionStrategy,
  POPUP_TYPE,
  POPUP_RESULT,
  type WorldInfoEntry,
  WorldInfoPosition,
  WorldInfoLogic,
} from '../types';
import * as api from '../api/world-info';
import { toast } from '../composables/useToast';
import { debounce } from '../utils/common';
import { defaultsDeep } from 'lodash-es';
import { usePopupStore } from './popup.store';
import { downloadFile } from '../utils/file';
import { useStrictI18n } from '../composables/useStrictI18n';

export const defaultWorldInfoSettings: WorldInfoSettings = {
  world_info: {},
  world_info_depth: 2,
  world_info_min_activations: 0,
  world_info_min_activations_depth_max: 0,
  world_info_budget: 25,
  world_info_include_names: true,
  world_info_recursive: false,
  world_info_overflow_alert: false,
  world_info_case_sensitive: false,
  world_info_match_whole_words: false,
  world_info_character_strategy: WorldInfoInsertionStrategy.CHARACTER_FIRST,
  world_info_budget_cap: 0,
  world_info_use_group_scoring: false,
  world_info_max_recursion_steps: 0,
};

const WI_SORT_ORDER_KEY = 'world_info_sort_order';

export const useWorldInfoStore = defineStore('world-info', () => {
  const { t } = useStrictI18n();
  const settingsStore = useSettingsStore();
  const popupStore = usePopupStore();

  const isPanelPinned = ref(false);
  const bookNames = ref<string[]>([]);
  const activeBookNames = ref<string[]>([]);
  const worldInfoCache = ref<Record<string, WorldInfoBook>>({});

  const selectedItemId = ref<'global-settings' | string | null>('global-settings');
  const expandedBooks = ref<Set<string>>(new Set());
  const browserSearchTerm = ref('');
  const sortOrder = ref(settingsStore.getAccountItem(WI_SORT_ORDER_KEY) ?? 'order:asc');
  const loadingBooks = ref<Set<string>>(new Set());

  watch(sortOrder, (newOrder) => {
    settingsStore.setAccountItem(WI_SORT_ORDER_KEY, newOrder);
  });

  const settings = computed({
    get: () => settingsStore.settings.world_info_settings,
    set: (value) => {
      settingsStore.setSetting('world_info_settings', { ...value });
    },
  });

  const selectedEntry = computed<WorldInfoEntry | null>(() => {
    if (typeof selectedItemId.value !== 'string' || !selectedItemId.value.includes('/')) return null;
    const [bookName, entryUidStr] = selectedItemId.value.split('/');
    const entryUid = parseInt(entryUidStr, 10);
    const book = worldInfoCache.value[bookName];
    return book?.entries.find((e) => e.uid === entryUid) ?? null;
  });

  const selectedBookForEntry = computed<WorldInfoBook | null>(() => {
    if (!selectedEntry.value || typeof selectedItemId.value !== 'string') return null;
    const [bookName] = selectedItemId.value.split('/');
    return worldInfoCache.value[bookName] ?? null;
  });

  // TODO: Potential performance bottleneck for very large lorebooks, but acceptable for now.
  // Can be optimized with debouncing or memoization if it becomes a problem.
  function filteredAndSortedEntries(bookName: string): WorldInfoEntry[] {
    const book = worldInfoCache.value[bookName];
    if (!book) return [];

    let entries = [...book.entries];

    // Filter based on search term
    if (browserSearchTerm.value) {
      const lowerSearch = browserSearchTerm.value.toLowerCase();
      entries = entries.filter(
        (entry) =>
          entry.comment.toLowerCase().includes(lowerSearch) ||
          entry.key.join(',').toLowerCase().includes(lowerSearch) ||
          entry.content.toLowerCase().includes(lowerSearch) ||
          String(entry.uid).includes(lowerSearch),
      );
    }

    // Sort the (potentially filtered) entries
    const [field, direction] = sortOrder.value.split(':');
    entries.sort((a, b) => {
      let valA = (a as any)[field];
      let valB = (b as any)[field];
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return entries;
  }

  watch(
    () => settingsStore.settings.world_info_settings,
    (newSettings) => {
      if (newSettings) {
        const newValues = defaultsDeep({}, newSettings, defaultWorldInfoSettings);
        if (JSON.stringify(settings.value) !== JSON.stringify(newValues)) {
          settings.value = newValues;
        }
        activeBookNames.value = settings.value.world_info?.globalSelect ?? [];
      }
    },
    { deep: true, immediate: true },
  );

  watch(
    activeBookNames,
    (newActive) => {
      if (!settings.value.world_info) {
        settings.value.world_info = {};
      }
      settings.value.world_info.globalSelect = newActive;
      saveBookDebounced();
    },
    { deep: true },
  );

  function getBookFromCache(name: string): WorldInfoBook | undefined {
    return worldInfoCache.value[name];
  }

  async function initialize() {
    try {
      bookNames.value = (await api.fetchAllWorldInfoNames()).sort((a, b) => a.localeCompare(b));
    } catch (error) {
      console.error('Failed to load world info list:', error);
      toast.error('Could not load lorebooks.');
    }
  }

  async function refresh() {
    worldInfoCache.value = {};
    await initialize();
    toast.success('Lorebooks refreshed.');
  }

  async function selectItem(id: 'global-settings' | string | null) {
    if (id && id !== 'global-settings') {
      const [bookName] = id.split('/');
      if (!worldInfoCache.value[bookName]) {
        await fetchBook(bookName);
      }
    }
    selectedItemId.value = id;
  }

  async function fetchBook(bookName: string) {
    if (loadingBooks.value.has(bookName)) return; // Already fetching
    try {
      loadingBooks.value.add(bookName);
      const book = await api.fetchWorldInfoBook(bookName);
      worldInfoCache.value[bookName] = book;
    } catch (error) {
      console.error(`Failed to load book ${bookName}:`, error);
      toast.error(`Could not load lorebook: ${bookName}`);
    } finally {
      loadingBooks.value.delete(bookName);
    }
  }

  function toggleBookExpansion(bookName: string) {
    if (expandedBooks.value.has(bookName)) {
      expandedBooks.value.delete(bookName);
    } else {
      expandedBooks.value.add(bookName);
      if (!worldInfoCache.value[bookName]) {
        fetchBook(bookName);
      }
    }
  }

  const saveBookDebounced = debounce(async (book?: WorldInfoBook) => {
    if (book) {
      try {
        await api.saveWorldInfoBook(book.name, book);
        worldInfoCache.value[book.name] = JSON.parse(JSON.stringify(book));
        // Do not toast on every auto-save, it's too noisy.
      } catch (error) {
        console.error('Failed to save lorebook:', error);
        toast.error('Failed to save lorebook.');
      }
    } else {
      settingsStore.saveSettingsDebounced();
    }
  }, 1000);

  function updateSelectedEntry(newEntryData: WorldInfoEntry) {
    if (!selectedEntry.value || !selectedBookForEntry.value) return;
    const book = selectedBookForEntry.value;
    const index = book.entries.findIndex((e) => e.uid === newEntryData.uid);
    if (index !== -1) {
      book.entries[index] = { ...newEntryData };
      saveBookDebounced(book);
    }
  }

  async function createNewBook() {
    const { result, value: newName } = await popupStore.show({
      title: t('worldInfo.popup.newBookTitle'),
      content: t('worldInfo.popup.newBookContent'),
      type: POPUP_TYPE.INPUT,
      inputValue: t('worldInfo.popup.newBookInput'),
    });
    if (result === POPUP_RESULT.AFFIRMATIVE && newName) {
      const newBook: WorldInfoBook = { name: newName, entries: [] };
      try {
        await api.saveWorldInfoBook(newName, newBook);
        await initialize();
        toggleBookExpansion(newName);
        toast.success(`Created lorebook: ${newName}`);
      } catch (error) {
        toast.error(`Failed to create lorebook.`);
      }
    }
  }

  function getNewUid(book: WorldInfoBook): number {
    return book.entries.length > 0 ? Math.max(...book.entries.map((e) => e.uid)) + 1 : 1;
  }

  async function createNewEntry(bookName: string) {
    const book = worldInfoCache.value[bookName];
    if (!book) return;

    const newUid = getNewUid(book);
    const newEntry: WorldInfoEntry = {
      uid: newUid,
      key: [],
      keysecondary: [],
      comment: 'New Entry',
      content: '',
      constant: false,
      vectorized: false,
      selective: false,
      selectiveLogic: WorldInfoLogic.AND_ANY,
      addMemo: false,
      order: 100,
      position: WorldInfoPosition.BEFORE_CHAR,
      disable: false,
      ignoreBudget: false,
      excludeRecursion: false,
      preventRecursion: false,
      matchPersonaDescription: false,
      matchCharacterDescription: false,
      matchCharacterPersonality: false,
      matchCharacterDepthPrompt: false,
      matchScenario: false,
      matchCreatorNotes: false,
      delayUntilRecursion: false,
      probability: 100,
      useProbability: false,
      depth: 4,
      outletName: '',
      group: '',
      groupOverride: false,
      groupWeight: 100,
      scanDepth: null,
      caseSensitive: null,
      matchWholeWords: null,
      useGroupScoring: null,
      automationId: '',
      role: 0,
      sticky: null,
      cooldown: null,
      delay: null,
      characterFilterNames: [],
      characterFilterTags: [],
      characterFilterExclude: false,
      triggers: [],
    };

    book.entries.unshift(newEntry);
    saveBookDebounced(book);
    selectItem(`${bookName}/${newUid}`);
  }

  async function deleteBook(name: string) {
    const { result } = await popupStore.show({
      title: t('common.confirmDelete'),
      content: t('worldInfo.popup.deleteBookContent', { name }),
      type: POPUP_TYPE.CONFIRM,
    });
    if (result === POPUP_RESULT.AFFIRMATIVE) {
      try {
        await api.deleteWorldInfoBook(name);
        delete worldInfoCache.value[name];
        if (selectedItemId.value?.startsWith(`${name}/`)) {
          selectItem('global-settings');
        }
        await initialize();
        toast.success(`Deleted lorebook: ${name}`);
      } catch (error) {
        toast.error('Failed to delete lorebook.');
      }
    }
  }

  async function renameBook(oldName: string) {
    const { result, value: newName } = await popupStore.show({
      title: t('worldInfo.popup.renameBookTitle'),
      type: POPUP_TYPE.INPUT,
      inputValue: oldName,
    });

    if (result === POPUP_RESULT.AFFIRMATIVE && newName && newName.trim() && newName !== oldName) {
      try {
        await api.renameWorldInfoBook(oldName, newName);
        toast.success(`Lorebook renamed to "${newName}".`);
        delete worldInfoCache.value[oldName];
        if (selectedItemId.value?.startsWith(`${oldName}/`)) {
          selectedItemId.value = selectedItemId.value.replace(oldName, newName);
        }
        await initialize();
      } catch (error) {
        toast.error('Failed to rename lorebook.');
      }
    }
  }

  async function duplicateBook(sourceName: string) {
    const { result, value: newName } = await popupStore.show({
      title: t('worldInfo.popup.duplicateBookTitle'),
      type: POPUP_TYPE.INPUT,
      inputValue: `${sourceName}${t('worldInfo.popup.duplicateBookInputSuffix')}`,
    });
    if (result === POPUP_RESULT.AFFIRMATIVE && newName && newName.trim()) {
      try {
        await api.duplicateWorldInfoBook(sourceName, newName);
        toast.success(`Lorebook "${sourceName}" duplicated as "${newName}".`);
        await initialize();
      } catch (error) {
        toast.error('Failed to duplicate lorebook.');
      }
    }
  }

  async function deleteSelectedEntry() {
    if (!selectedEntry.value || !selectedBookForEntry.value) return;
    const book = selectedBookForEntry.value;
    const entry = selectedEntry.value;

    const { result } = await popupStore.show({
      title: t('worldInfo.popup.deleteEntryTitle'),
      content: t('worldInfo.popup.deleteEntryContent', { name: entry.comment }),
      type: POPUP_TYPE.CONFIRM,
    });
    if (result === POPUP_RESULT.AFFIRMATIVE) {
      const index = book.entries.findIndex((e) => e.uid === entry.uid);
      if (index !== -1) {
        book.entries.splice(index, 1);
        saveBookDebounced(book);
        selectItem('global-settings');
      }
    }
  }

  async function duplicateSelectedEntry() {
    if (!selectedEntry.value || !selectedBookForEntry.value) return;
    const book = selectedBookForEntry.value;
    const entryToCopy = selectedEntry.value;

    const newEntry = {
      ...entryToCopy,
      uid: getNewUid(book),
      comment: `${entryToCopy.comment} (copy)`,
    };
    book.entries.unshift(newEntry);
    saveBookDebounced(book);
    selectItem(`${book.name}/${newEntry.uid}`);
    toast.success(`Entry duplicated.`);
  }

  async function importBook(file: File) {
    try {
      const { name } = await api.importWorldInfoBook(file);
      await initialize();
      await fetchBook(name);
      toggleBookExpansion(name);
      toast.success(`Imported lorebook: ${name}`);
    } catch (error) {
      toast.error('Failed to import lorebook.');
    }
  }

  async function exportBook(name: string) {
    try {
      const book = await api.exportWorldInfoBook(name);
      const content = JSON.stringify(book, null, 2);
      downloadFile(content, `${book.name}.json`, 'application/json');
    } catch (error) {
      toast.error('Failed to export lorebook.');
    }
  }

  return {
    isPanelPinned,
    settings,
    bookNames,
    activeBookNames,
    worldInfoCache,
    selectedItemId,
    expandedBooks,
    browserSearchTerm,
    sortOrder,
    loadingBooks,
    selectedEntry,
    selectedBookForEntry,
    filteredAndSortedEntries,
    initialize,
    refresh,
    selectItem,
    toggleBookExpansion,
    updateSelectedEntry,
    createNewBook,
    createNewEntry,
    deleteBook,
    renameBook,
    duplicateBook,
    deleteSelectedEntry,
    duplicateSelectedEntry,
    getBookFromCache,
    importBook,
    exportBook,
    saveBookDebounced,
  };
});
