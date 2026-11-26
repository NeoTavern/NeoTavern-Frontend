import { vi } from 'vitest';
import type {
  Character,
  ChatMessage,
  Persona,
  PersonaDescription,
  WorldInfoBook,
  WorldInfoEntry,
} from '../../../../types';

export function entry(uid: number, fields: Partial<WorldInfoEntry> = {}): WorldInfoEntry {
  return { uid, comment: '', key: [], content: '', constant: false, ...fields } as WorldInfoEntry;
}

/** An in-memory stand-in for the data parts of `ExtensionAPI`, with spied writes. */
export function fakeDataApi(
  options: {
    characters?: Partial<Character>[];
    history?: Partial<ChatMessage>[];
    books?: WorldInfoBook[];
    persona?: Persona;
  } = {},
) {
  const characters = (options.characters ?? []).map((character) => structuredClone(character)) as Character[];
  const history = (options.history ?? []).map((message) => ({ ...message })) as ChatMessage[];
  const books = structuredClone(options.books ?? []);
  const persona = options.persona ? { ...options.persona } : null;
  const book = (name: string) => books.find((candidate) => candidate.name === name);

  return {
    store: { characters, history, books, persona },
    character: {
      getAll: () => characters,
      get: (avatar: string) => characters.find((character) => character.avatar === avatar) ?? null,
      update: vi.fn(async (avatar: string, data: Partial<Character>) => {
        const character = characters.find((candidate) => candidate.avatar === avatar)!;
        const { data: nested, ...top } = data;
        Object.assign(character, top);
        if (nested) character.data = { ...character.data, ...nested } as Character['data'];
      }),
    },
    chat: {
      getHistory: () => history,
      getMessage: (index: number) => history[index],
      updateMessage: vi.fn(async (index: number, content: string) => {
        history[index].mes = content;
      }),
    },
    worldInfo: {
      getAllBookNames: () => books.map((candidate) => ({ file_id: candidate.name, name: candidate.name })),
      // Like the real backend: an unknown name gives an empty book, not null.
      getBook: async (name: string) => structuredClone(book(name) ?? { name, entries: [] }),
      createDefaultEntry: (uid: number) => entry(uid, { order: 100 }),
      createEntry: vi.fn(async (name: string, created: WorldInfoEntry) => {
        book(name)!.entries.push(structuredClone(created));
      }),
      updateEntry: vi.fn(async (name: string, updated: WorldInfoEntry) => {
        const entries = book(name)!.entries;
        entries[entries.findIndex((candidate) => candidate.uid === updated.uid)] = structuredClone(updated);
      }),
      deleteEntry: vi.fn(async (name: string, uid: number) => {
        const entries = book(name)!.entries;
        entries.splice(
          entries.findIndex((candidate) => candidate.uid === uid),
          1,
        );
      }),
    },
    persona: {
      getActive: () => persona,
      getAll: () => (persona ? [persona] : []),
      updateActiveField: vi.fn(async <K extends keyof PersonaDescription>(field: K, value: PersonaDescription[K]) => {
        (persona as PersonaDescription)[field] = value;
      }),
    },
  };
}

export type FakeDataApi = ReturnType<typeof fakeDataApi>;

export function writeSpies(api: FakeDataApi) {
  return [
    api.character.update,
    api.chat.updateMessage,
    api.worldInfo.createEntry,
    api.worldInfo.updateEntry,
    api.worldInfo.deleteEntry,
    api.persona.updateActiveField,
  ];
}
