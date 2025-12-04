import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { WorldInfoBook, WorldInfoEntry } from '../types';
import { useSettingsStore } from './settings.store';
import { useWorldInfoStore } from './world-info.store';
import { useLayoutStore } from './layout.store';

export const useWorldInfoUiStore = defineStore('world-info-ui', () => {
  const settingsStore = useSettingsStore();
  const worldInfoStore = useWorldInfoStore();
  const layoutStore = useLayoutStore();

  const isPanelPinned = ref(false);
  const selectedItemId = ref<'global-settings' | string | null>('global-settings');
  const expandedBooks = ref<Set<string>>(new Set());
  const browserSearchTerm = ref('');

  const sortOrder = computed({
    get: () => settingsStore.settings.account.worldInfoSortOrder ?? 'order:asc',
    set: (value) => (settingsStore.settings.account.worldInfoSortOrder = value),
  });

  const selectedFilename = computed<string | null>(() => {
    if (typeof selectedItemId.value !== 'string' || !selectedItemId.value.includes('/')) return null;
    const [filename] = selectedItemId.value.split('/');
    return filename;
  });

  const selectedEntry = computed<WorldInfoEntry | null>(() => {
    if (typeof selectedItemId.value !== 'string' || !selectedItemId.value.includes('/')) return null;
    const [filename, entryUidStr] = selectedItemId.value.split('/');
    const entryUid = parseInt(entryUidStr, 10);

    const book = worldInfoStore.worldInfoCache[filename];
    return book?.entries.find((e) => e.uid === entryUid) ?? null;
  });

  const selectedBookForEntry = computed<WorldInfoBook | null>(() => {
    return selectedFilename.value ? worldInfoStore.worldInfoCache[selectedFilename.value] || null : null;
  });

  function toggleBookExpansion(filename: string) {
    if (expandedBooks.value.has(filename)) {
      expandedBooks.value.delete(filename);
    } else {
      expandedBooks.value.add(filename);
      if (!worldInfoStore.worldInfoCache[filename]) {
        worldInfoStore.fetchBook(filename);
      }
    }
  }

  function selectItem(id: 'global-settings' | string | null) {
    if (id && id !== 'global-settings') {
      const [filename] = id.split('/');
      if (!worldInfoStore.worldInfoCache[filename]) {
        worldInfoStore.fetchBook(filename);
      }
    }
    selectedItemId.value = id;
    layoutStore.autoCloseLeftSidebarOnMobile();
  }

  function filteredAndSortedEntries(filename: string): WorldInfoEntry[] {
    const book = worldInfoStore.worldInfoCache[filename];
    if (!book) return [];

    let entries = [...book.entries];

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

    const [field, direction] = sortOrder.value.split(':');
    entries.sort((a, b) => {
      let valA = (a as never)[field] as string;
      let valB = (b as never)[field] as string;
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return entries;
  }

  return {
    isPanelPinned,
    selectedItemId,
    expandedBooks,
    browserSearchTerm,
    sortOrder,
    selectedFilename,
    selectedEntry,
    selectedBookForEntry,
    toggleBookExpansion,
    selectItem,
    filteredAndSortedEntries,
  };
});
