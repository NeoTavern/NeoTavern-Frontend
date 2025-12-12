import { debounce } from 'lodash-es';
import { defineStore } from 'pinia';
import { computed, nextTick, ref } from 'vue';
import * as api from '../api/world-info';
import { useStrictI18n } from '../composables/useStrictI18n';
import { toast } from '../composables/useToast';
import { DebounceTimeout } from '../constants';
import { createDefaultEntry } from '../services/world-info';
import { type WorldInfoBook, type WorldInfoEntry, type WorldInfoHeader } from '../types';
import { downloadFile, uuidv4 } from '../utils/commons';
import { eventEmitter } from '../utils/extensions';
import { useCharacterStore } from './character.store';
import { useChatStore } from './chat.store';
import { usePersonaStore } from './persona.store';
import { useSettingsStore } from './settings.store';

export const useWorldInfoStore = defineStore('world-info', () => {
  const { t } = useStrictI18n();
  const settingsStore = useSettingsStore();
  const personaStore = usePersonaStore();
  const chatStore = useChatStore();
  const characterStore = useCharacterStore();

  const bookInfos = ref<WorldInfoHeader[]>([]);
  const worldInfoCache = ref<Record<string, WorldInfoBook>>({}); // filename -> book
  const loadingBooks = ref<Set<string>>(new Set());

  const activeBookNames = computed<string[]>(() => {
    const global = settingsStore.settings.worldInfo.activeBookNames || [];
    const persona = personaStore.activePersona?.lorebooks || [];
    const chat = chatStore.activeChat?.metadata.chat_lorebooks || [];

    const charBooks = new Set<string>();
    for (const char of characterStore.activeCharacters) {
      if (char.data?.character_book?.name) {
        charBooks.add(char.data.character_book.name);
      }
    }

    const uniqueNames = new Set<string>([...global, ...persona, ...chat, ...charBooks]);
    return Array.from(uniqueNames);
  });

  const globalBookNames = computed<string[]>({
    get: () => settingsStore.settings.worldInfo.activeBookNames || [],
    set: (value) => {
      settingsStore.settings.worldInfo.activeBookNames = value;
    },
  });

  async function getBookFromCache(filename: string, force?: boolean): Promise<WorldInfoBook | undefined> {
    if (force && !worldInfoCache.value[filename]) {
      await fetchBook(filename);
    }
    return worldInfoCache.value[filename];
  }

  async function initialize() {
    try {
      bookInfos.value = (await api.listAllWorldInfoBooks()).sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error('Failed to load world info list:', error);
      toast.error(t('worldInfo.errors.loadListFailed'));
    }
  }

  async function fetchBook(filename: string) {
    if (loadingBooks.value.has(filename)) return;
    try {
      loadingBooks.value.add(filename);
      const book = await api.fetchWorldInfoBook(filename);
      if (book.entries) {
        book.name = book.name ?? filename;
        worldInfoCache.value[filename] = book;
      }
    } catch (error) {
      console.error(`Failed to load book ${filename}:`, error);
      toast.error(t('worldInfo.errors.loadFailed', { name: filename }));
    } finally {
      loadingBooks.value.delete(filename);
    }
  }

  const saveBookDebounced = debounce(async (book?: WorldInfoBook) => {
    if (book) {
      try {
        await api.saveWorldInfoBook(book.name, book);
        worldInfoCache.value[book.name] = JSON.parse(JSON.stringify(book));
        await nextTick();
        await eventEmitter.emit('world-info:book-updated', book);
      } catch (error) {
        console.error('Failed to save lorebook:', error);
        toast.error(t('worldInfo.errors.saveFailed'));
      }
    } else {
      settingsStore.saveSettingsDebounced();
    }
  }, DebounceTimeout.RELAXED);

  async function updateEntry(book: WorldInfoBook, newEntryData: WorldInfoEntry) {
    const index = book.entries.findIndex((e) => e.uid === newEntryData.uid);
    if (index !== -1) {
      book.entries[index] = { ...newEntryData };
      saveBookDebounced(book);
      await nextTick();
      await eventEmitter.emit('world-info:entry-updated', book.name, newEntryData);
    }
  }

  async function createBook(name: string, content?: WorldInfoBook): Promise<string | undefined> {
    const filename = uuidv4();
    const newBook = content ?? { name: name, entries: [] };

    try {
      await api.importWorldInfoBook(
        new File([JSON.stringify(newBook, null, 2)], `${filename}.json`, { type: 'application/json' }),
      );
      worldInfoCache.value[filename] = newBook;
      bookInfos.value.push({ file_id: filename, name: newBook.name });
      await nextTick();
      await eventEmitter.emit('world-info:book-created', name);
      return filename;
    } catch (error: unknown) {
      toast.error(t('worldInfo.errors.createFailed'));
      console.error('Failed to create lorebook:', error);
    }
  }

  function getNewUid(book: WorldInfoBook): number {
    return book.entries.length > 0 ? Math.max(...book.entries.map((e) => e.uid)) + 1 : 1;
  }

  async function createEntry(filename: string): Promise<WorldInfoEntry | undefined> {
    const book = worldInfoCache.value[filename];
    if (!book) return;

    const newUid = getNewUid(book);
    const newEntry = createDefaultEntry(newUid);

    book.entries.unshift(newEntry);
    saveBookDebounced(book);

    await nextTick();
    await eventEmitter.emit('world-info:entry-created', filename, newEntry);
    return newEntry;
  }

  async function deleteBook(filename: string) {
    try {
      await api.deleteWorldInfoBook(filename);
      delete worldInfoCache.value[filename];
      bookInfos.value = bookInfos.value.filter((b) => b.file_id !== filename);
      await nextTick();
      await eventEmitter.emit('world-info:book-deleted', filename);
    } catch (error: unknown) {
      console.error('Failed to delete lorebook:', error);
      toast.error(t('worldInfo.errors.deleteFailed'));
      throw error;
    }
  }

  async function renameBook(filename: string, newName: string) {
    const book = await getBookFromCache(filename, true);
    if (!book) {
      toast.error(t('worldInfo.errors.bookNotFound', { name: filename }));
      return;
    }
    try {
      book.name = newName;
      await api.saveWorldInfoBook(filename, book);
      const bookInfo = bookInfos.value.find((b) => b.file_id === filename);
      if (bookInfo) {
        bookInfo.name = newName;
      }
      await nextTick();
      await eventEmitter.emit('world-info:book-renamed', filename, newName);
    } catch (error: unknown) {
      console.error('Failed to rename lorebook:', error);
      toast.error(t('worldInfo.errors.renameFailed'));
    }
  }

  async function deleteEntry(filename: string, entryUid: number) {
    const book = worldInfoCache.value[filename];
    if (!book) return;

    const index = book.entries.findIndex((e) => e.uid === entryUid);
    if (index !== -1) {
      book.entries.splice(index, 1);
      saveBookDebounced(book);
      await nextTick();
      await eventEmitter.emit('world-info:entry-deleted', book.name, entryUid);
    }
  }

  async function duplicateEntry(filename: string, entry: WorldInfoEntry) {
    const book = worldInfoCache.value[filename];
    if (!book) return;

    const entryToCopy = JSON.parse(JSON.stringify(entry));
    const newEntry = {
      ...entryToCopy,
      uid: getNewUid(book),
      comment: `${entryToCopy.comment} (copy)`,
    };
    book.entries.unshift(newEntry);
    saveBookDebounced(book);

    return newEntry.uid;
  }

  async function importBook(file: File): Promise<string | undefined> {
    try {
      const filename = uuidv4();
      const newFile = new File([file], `${filename}.json`, { type: file.type });
      const { name } = await api.importWorldInfoBook(newFile);
      // We don't automatically fetch it here, UI decides when to show it
      bookInfos.value.push({ file_id: filename, name });
      await nextTick();
      await eventEmitter.emit('world-info:book-imported', name);
      return filename;
    } catch (error: unknown) {
      console.error('Failed to import lorebook:', error);
      toast.error(t('worldInfo.errors.importFailed'));
    }
  }

  async function exportBook(name: string) {
    try {
      const book = await getBookFromCache(name, true);
      if (!book) {
        toast.error(t('worldInfo.errors.bookNotFound', { name }));
        return;
      }
      const content = JSON.stringify(book, null, 2);
      downloadFile(content, `${book.name}.json`, 'application/json');
    } catch (error: unknown) {
      console.error('Failed to export lorebook:', error);
      toast.error(t('worldInfo.errors.exportFailed'));
    }
  }

  return {
    bookInfos,
    activeBookNames,
    globalBookNames,
    worldInfoCache,
    loadingBooks,
    initialize,
    updateEntry,
    createBook,
    createEntry,
    deleteBook,
    renameBook,
    deleteEntry,
    duplicateEntry,
    getBookFromCache,
    fetchBook,
    importBook,
    exportBook,
    saveBookDebounced,
  };
});
