import type { Character, ExtensionAPI, Persona, WorldInfoEntry } from '../../../types';
import { characterShape, clampRange, entryShape, messageShape, personaShape } from './shapes';
import type { AssistantCommand } from './types';

/** A mention, resolved to absolute ids when picked. */
export type AssistantRef =
  | { kind: 'character'; avatar: string; label: string }
  | { kind: 'persona'; avatarId: string; label: string }
  | { kind: 'lorebook'; book: string; label: string }
  | { kind: 'entry'; book: string; uid: number; label: string }
  /** '#12' → 12..12, '#last5' → len-5..len-1 (clamped). */
  | { kind: 'messages'; from: number; to: number; label: string };

export interface AtSources {
  characters: Pick<Character, 'avatar' | 'name'>[];
  personas: Pick<Persona, 'avatarId' | 'name'>[];
  books: string[];
  /** Entries of the books the caller has loaded. */
  entries: { book: string; entries: Pick<WorldInfoEntry, 'uid' | 'comment'>[] }[];
}

function matches(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

export function entryRefLabel(book: string, entry: Pick<WorldInfoEntry, 'uid' | 'comment'>): string {
  return `${book}/${entry.comment || `#${entry.uid}`}`;
}

/** `@` suggestions: characters, personas, lorebooks, then entries, filtered by name (case-insensitive). */
export function suggestAt(query: string, sources: AtSources): AssistantRef[] {
  return [
    ...sources.characters
      .filter((character) => matches(character.name, query))
      .map((character): AssistantRef => ({ kind: 'character', avatar: character.avatar, label: character.name })),
    ...sources.personas
      .filter((persona) => matches(persona.name, query))
      .map((persona): AssistantRef => ({ kind: 'persona', avatarId: persona.avatarId, label: persona.name })),
    ...sources.books
      .filter((book) => matches(book, query))
      .map((book): AssistantRef => ({ kind: 'lorebook', book, label: book })),
    ...sources.entries.flatMap(({ book, entries }) =>
      entries
        .map((entry): AssistantRef => ({ kind: 'entry', book, uid: entry.uid, label: entryRefLabel(book, entry) }))
        .filter((ref) => matches(ref.label, query)),
    ),
  ];
}

/** Parses the text after `#`: `N` (0-based index), `last` or `lastN`. Null when it names no message. */
export function parseMessageRef(token: string, historyLength: number): AssistantRef | null {
  const index = /^(\d+)$/.exec(token);
  if (index) {
    const at = Number(index[1]);
    return at < historyLength ? { kind: 'messages', from: at, to: at, label: `#${at}` } : null;
  }
  const last = /^last(\d*)$/.exec(token);
  if (!last) return null;
  const count = last[1] ? Number(last[1]) : 1;
  const range = clampRange(historyLength - count, historyLength - 1, historyLength);
  return range && count > 0 ? { kind: 'messages', ...range, label: `#${token}` } : null;
}

/** `#` suggestions for the typed query. */
export function suggestMessages(query: string, historyLength: number): AssistantRef[] {
  const tokens =
    /^\d+$/.test(query) || /^last\d+$/.test(query) ? [query] : 'last'.startsWith(query) ? ['last', 'last5'] : [];
  return tokens.flatMap((token) => parseMessageRef(token, historyLength) ?? []);
}

/** `/` suggestions: saved commands whose name matches. */
export function suggestCommands(query: string, commands: AssistantCommand[]): AssistantCommand[] {
  return commands.filter((command) => matches(command.name, query));
}

/** A `/name` at the start of the text becomes that command's prompt, followed by the rest of the text. */
export function expandCommand(text: string, commands: AssistantCommand[]): string {
  const match = /^\/([a-z0-9][a-z0-9-]*)(?:\s+|$)/.exec(text);
  const command = match && commands.find((candidate) => candidate.name === match[1]);
  if (!command) return text;
  const rest = text.slice(match[0].length);
  return rest ? `${command.prompt}\n\n${rest}` : command.prompt;
}

export type ReferencesAPI = {
  character: Pick<ExtensionAPI['character'], 'get'>;
  persona: Pick<ExtensionAPI['persona'], 'getAll'>;
  worldInfo: Pick<ExtensionAPI['worldInfo'], 'getBook'>;
  chat: Pick<ExtensionAPI['chat'], 'getHistory'>;
};

async function resolveRef(api: ReferencesAPI, ref: AssistantRef): Promise<{ heading: string; content: unknown }> {
  switch (ref.kind) {
    case 'character': {
      const character = api.character.get(ref.avatar);
      return { heading: 'character', content: character ? characterShape(character) : notFound(ref) };
    }
    case 'persona': {
      const persona = api.persona.getAll().find((candidate) => candidate.avatarId === ref.avatarId);
      return { heading: 'persona', content: persona ? personaShape(persona) : notFound(ref) };
    }
    case 'lorebook': {
      const book = await api.worldInfo.getBook(ref.book);
      return { heading: `lorebook "${ref.book}"`, content: book ? book.entries.map(entryShape) : notFound(ref) };
    }
    case 'entry': {
      const book = await api.worldInfo.getBook(ref.book);
      const entry = book?.entries.find((candidate) => candidate.uid === ref.uid);
      return { heading: `lorebook "${ref.book}" entry`, content: entry ? entryShape(entry) : notFound(ref) };
    }
    case 'messages': {
      const history = api.chat.getHistory();
      const range = clampRange(ref.from, ref.to, history.length);
      const messages = range
        ? history.slice(range.from, range.to + 1).map((message, offset) => messageShape(message, range.from + offset))
        : [];
      return { heading: `messages ${ref.from}..${ref.to}`, content: messages };
    }
  }
}

function notFound(ref: AssistantRef) {
  return { error: `${ref.label} not found` };
}

/**
 * The `[Referenced]` block put ahead of the user text: each ref's current content, in the shapes the
 * read tools return. Empty when there are no refs.
 */
export async function renderReferencedBlock(api: ReferencesAPI, refs: AssistantRef[]): Promise<string> {
  if (refs.length === 0) return '';
  const sections = await Promise.all(
    refs.map(async (ref) => {
      const { heading, content } = await resolveRef(api, ref);
      return `${ref.label} (${heading}):\n${JSON.stringify(content, null, 2)}`;
    }),
  );
  return ['[Referenced]', ...sections].join('\n\n');
}
