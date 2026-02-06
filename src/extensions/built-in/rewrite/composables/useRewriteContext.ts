import { computed, onMounted, ref, type Ref, watch } from 'vue';
import type { Character, ExtensionAPI, WorldInfoBook, WorldInfoHeader } from '../../../../types';
import type { RewriteSettings } from '../types';

export function useRewriteContext(
  api: ExtensionAPI<RewriteSettings>,
  identifier: string,
  selectedContextLorebooks: Ref<string[]>,
  selectedContextEntries: Ref<Record<string, number[]>>,
) {
  const allBookHeaders = ref<WorldInfoHeader[]>([]);
  const bookCache = ref<Record<string, WorldInfoBook>>({});
  const allCharacters = ref<Character[]>([]);

  const selectedEntryContext = ref<{ bookName: string; entry: { uid: number; comment: string } } | null>(null);

  const availableLorebooks = computed(() => {
    return allBookHeaders.value.map((b) => ({ label: b.name, value: b.name }));
  });

  const availableCharacters = computed(() => {
    let excludeAvatar = '';
    const IS_CHARACTER_FIELD = identifier.startsWith('character.');
    if (IS_CHARACTER_FIELD) {
      const editing = api.character.getEditing();
      if (editing) excludeAvatar = editing.avatar;
    }
    return allCharacters.value
      .filter((c) => c.avatar !== excludeAvatar)
      .map((c) => ({ label: c.name, value: c.avatar }));
  });

  onMounted(async () => {
    // Load world info data
    allBookHeaders.value = api.worldInfo.getAllBookNames();
    allCharacters.value = api.character.getAll();

    // Get current context if available
    const currentCtx = api.worldInfo.getSelectedEntry();
    if (currentCtx) {
      selectedEntryContext.value = {
        bookName: currentCtx.bookName,
        entry: {
          uid: currentCtx.entry.uid,
          comment: currentCtx.entry.comment,
        },
      };
    }

    // Ensure selected books are loaded
    for (const book of selectedContextLorebooks.value) {
      await ensureBookLoaded(book);
    }
  });

  watch(selectedContextLorebooks, async (newBooks) => {
    for (const book of newBooks) {
      await ensureBookLoaded(book);
    }
    for (const key of Object.keys(selectedContextEntries.value)) {
      if (!newBooks.includes(key)) {
        delete selectedContextEntries.value[key];
      }
    }
  });

  async function ensureBookLoaded(bookName: string) {
    if (!bookCache.value[bookName]) {
      try {
        const book = await api.worldInfo.getBook(bookName);
        if (book) {
          bookCache.value[bookName] = book;
        }
      } catch (error) {
        console.error(`Failed to load book ${bookName}`, error);
      }
    }
  }

  function getContextData() {
    let activeCharacter: Character | undefined;
    const persona = api.persona.getActive() || undefined;

    const IS_CHARACTER_FIELD = identifier.startsWith('character.');
    if (IS_CHARACTER_FIELD) {
      activeCharacter = api.character.getEditing() || undefined;
    } else {
      const actives = api.character.getActives();
      if (actives.length > 0) activeCharacter = actives[0];
    }
    return { activeCharacter, persona };
  }

  function getContextMessagesString(contextMessageCount: number, referenceMessageIndex?: number): string {
    if (contextMessageCount <= 0) return '';
    const history = api.chat.getHistory();
    if (history.length === 0) return '';
    const endIndex = referenceMessageIndex !== undefined ? referenceMessageIndex : history.length;
    const startIndex = Math.max(0, endIndex - contextMessageCount);
    const slice = history.slice(startIndex, endIndex);
    return slice.map((m) => `${m.name}: ${m.mes}`).join('\n');
  }

  function getAdditionalCharactersContext(selectedContextCharacters: string[]): string {
    if (selectedContextCharacters.length === 0) return '';
    const chars = selectedContextCharacters
      .map((avatar) => api.character.get(avatar))
      .filter((c) => c !== null) as Character[];
    return chars
      .map((c) => {
        let text = `Name: ${c.name}`;
        if (c.description) text += `\nDescription: ${c.description}`;
        if (c.personality) text += `\nPersonality: ${c.personality}`;
        if (c.scenario) text += `\nScenario: ${c.scenario}`;
        if (c.mes_example) text += `\nExample Messages: ${c.mes_example}`;
        return text;
      })
      .join('\n\n');
  }

  async function getWorldInfoContext(
    selectedContextLorebooks: string[],
    selectedContextEntries: Record<string, number[]>,
  ) {
    const macros: Record<string, unknown> = {};
    const currentFilename = api.worldInfo.getSelectedBookName();
    let currentBookUid: number | null = null;
    let currentBookName: string | null = null;

    if (currentFilename) {
      macros.selectedBook = { name: currentFilename };
      currentBookName = currentFilename;
    }

    const currentEntryCtx = api.worldInfo.getSelectedEntry();
    if (currentEntryCtx) {
      macros.selectedEntry = {
        uid: currentEntryCtx.entry.uid,
        key: currentEntryCtx.entry.key.join(', '),
        comment: currentEntryCtx.entry.comment,
        content: currentEntryCtx.entry.content,
      };
      currentBookUid = currentEntryCtx.entry.uid;
      currentBookName = currentEntryCtx.bookName;
    }

    if (selectedContextLorebooks.length > 0) {
      const otherBooksContent: string[] = [];
      for (const bookName of selectedContextLorebooks) {
        await ensureBookLoaded(bookName);
        const book = bookCache.value[bookName];
        if (book) {
          const entryIds = selectedContextEntries[bookName] || [];
          let entriesToInclude = book.entries;
          if (entryIds.length > 0) {
            entriesToInclude = book.entries.filter((e) => entryIds.includes(e.uid));
          }
          if (currentBookName === bookName && currentBookUid !== null) {
            entriesToInclude = entriesToInclude.filter((e) => e.uid !== currentBookUid);
          }
          if (entriesToInclude.length > 0) {
            const entriesSummary = entriesToInclude
              .map((e) => `- [${e.uid}] Keys: ${e.key.join(', ')} | Comment: ${e.comment}\n  Content: ${e.content}`)
              .join('\n');
            otherBooksContent.push(`Book: ${book.name}\n${entriesSummary}`);
          }
        }
      }
      macros.otherWorldInfo = otherBooksContent.join('\n\n');
    }
    return macros;
  }

  return {
    allBookHeaders,
    bookCache,
    allCharacters,
    selectedEntryContext,
    availableLorebooks,
    availableCharacters,
    ensureBookLoaded,
    getContextData,
    getContextMessagesString,
    getAdditionalCharactersContext,
    getWorldInfoContext,
  };
}
