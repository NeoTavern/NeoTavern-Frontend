import { cloneDeep } from 'lodash-es';
import { DEFAULT_CHARACTER } from '../../../constants';
import type { Character, ChatMessage, ExtensionAPI, WorldInfoBook, WorldInfoEntry } from '../../../types';
import { uuidv4 } from '../../../utils/commons';
import { CHARACTER_TEXT_FIELDS } from './shapes';

export type ChangeTarget =
  | { kind: 'character-field'; avatar: string; field: string }
  | { kind: 'message'; index: number }
  | { kind: 'entry'; book: string; uid: number; op: 'create' | 'update' | 'delete' }
  | { kind: 'persona-description'; avatarId: string }
  /** `index` is the position the message takes, in the chat as staged. */
  | { kind: 'message-insert'; index: number }
  | { kind: 'message-delete'; index: number }
  | { kind: 'lorebook'; book: string; op: 'create' | 'delete' }
  /** A create's avatar is `new:<change id>` until it's applied. */
  | { kind: 'character'; avatar: string; op: 'create' | 'delete' };

export interface StagedChange {
  id: string;
  target: ChangeTarget;
  label: string;
  oldValue: string;
  newValue: string;
  status: 'pending' | 'applied' | 'rejected' | 'conflict';
  /** Entry changes only: the full entries, for applying and undo. */
  entryBefore?: WorldInfoEntry;
  entryAfter?: WorldInfoEntry;
  /** Message insert: the message to insert. Message delete: the removed message. */
  message?: ChatMessage;
  /** Lorebook delete: the whole book, for undo. */
  bookBefore?: WorldInfoBook;
  /** Character create: the card to create. */
  card?: Partial<Character>;
  /** Set when applied. Batches are numbered "1", "2", … within a conversation. */
  applyBatch?: string;
}

export type StageInput = Pick<
  StagedChange,
  'target' | 'label' | 'oldValue' | 'newValue' | 'entryBefore' | 'entryAfter' | 'message' | 'bookBefore' | 'card'
>;

export type ChangesetAPI = {
  character: Pick<ExtensionAPI['character'], 'get' | 'update' | 'create' | 'delete'>;
  chat: Pick<ExtensionAPI['chat'], 'getHistory' | 'getMessage' | 'updateMessage' | 'insertMessage' | 'deleteMessage'>;
  worldInfo: Pick<
    ExtensionAPI['worldInfo'],
    'getAllBookNames' | 'getBook' | 'createBook' | 'deleteBook' | 'createEntry' | 'updateEntry' | 'deleteEntry'
  >;
  persona: Pick<ExtensionAPI['persona'], 'getActive' | 'updateActiveField'>;
};

export type UndoResult = { ok: true; undone: StagedChange[] } | { ok: false; conflicts: StagedChange[] };

export const NEW_CHARACTER_PREFIX = 'new:';

const ALTERNATE_GREETING = /^alternate_greetings\.(\d+)$/;

/** 0-based index of an `alternate_greetings.<n>` field (n is 1-based), or null for a top-level field. */
export function alternateGreetingIndex(field: string): number | null {
  const match = ALTERNATE_GREETING.exec(field);
  return match ? Number(match[1]) - 1 : null;
}

/** 0-based alternate greeting index of a change, or null when it isn't a greeting change. */
function greetingIndexOf(change: StagedChange): number | null {
  return change.target.kind === 'character-field' ? alternateGreetingIndex(change.target.field) : null;
}

/** An empty value on an existing alternate greeting removes the greeting; later ones shift up. */
export function isGreetingRemoval(change: Pick<StagedChange, 'target' | 'oldValue' | 'newValue'>): boolean {
  return (
    change.target.kind === 'character-field' &&
    alternateGreetingIndex(change.target.field) !== null &&
    change.oldValue !== '' &&
    change.newValue === ''
  );
}

/** A character delete can't be undone, so it's applied only on its own Accept. */
export function isCharacterDelete(change: Pick<StagedChange, 'target'>): boolean {
  return change.target.kind === 'character' && change.target.op === 'delete';
}

/**
 * Apply order groups: lorebook creates, character creates, the field/message/entry/persona edits,
 * greeting removals, message inserts and deletes, lorebook deletes, character deletes.
 */
function orderGroup(change: StagedChange): number {
  const target = change.target;
  switch (target.kind) {
    case 'lorebook':
      return target.op === 'create' ? 0 : 5;
    case 'character':
      return target.op === 'create' ? 1 : 6;
    case 'message-insert':
    case 'message-delete':
      return 4;
    default:
      return isGreetingRemoval(change) ? 3 : 2;
  }
}

/**
 * The order changes are applied in; undo runs it reversed. Greeting removals go highest index first
 * and message inserts and deletes by index descending (deletes before inserts at the same index,
 * same-index inserts in reverse staging order), so every staged index stays valid.
 */
function applyOrder(changes: StagedChange[]): StagedChange[] {
  const position = new Map(changes.map((change, index) => [change, index]));
  return [...changes].sort((a, b) => {
    const group = orderGroup(a) - orderGroup(b);
    if (group !== 0) return group;
    if (orderGroup(a) === 3) return greetingIndexOf(b)! - greetingIndexOf(a)!;
    if (orderGroup(a) === 4) {
      const ta = a.target as { kind: string; index: number };
      const tb = b.target as { kind: string; index: number };
      if (ta.index !== tb.index) return tb.index - ta.index;
      if (ta.kind !== tb.kind) return ta.kind === 'message-delete' ? -1 : 1;
      return position.get(b)! - position.get(a)!;
    }
    return position.get(a)! - position.get(b)!;
  });
}

/** The readable form of an entry shown in diffs and compared for conflicts. */
export function renderEntry(entry: Pick<WorldInfoEntry, 'comment' | 'key' | 'content'>): string {
  return `Title: ${entry.comment}\nKeys: ${entry.key.join(', ')}\n\n${entry.content}`;
}

/** The readable form of a whole lorebook, for a delete's diff and conflict check. */
export function renderBook(book: WorldInfoBook): string {
  return [`Lorebook: ${book.name}`, ...book.entries.map(renderEntry)].join('\n\n---\n\n');
}

/** The readable form of a character card: name, text fields and alternate greetings. */
export function renderCard(card: Partial<Character>): string {
  const parts = [`Name: ${card.name ?? ''}`];
  for (const field of CHARACTER_TEXT_FIELDS) {
    if (card[field]) parts.push(`${field}:\n${card[field]}`);
  }
  (card.data?.alternate_greetings ?? []).forEach((greeting, index) => {
    parts.push(`alternate_greetings.${index + 1}:\n${greeting}`);
  });
  return parts.join('\n\n');
}

function sameTarget(a: ChangeTarget, b: ChangeTarget): boolean {
  switch (a.kind) {
    case 'character-field':
      return b.kind === a.kind && b.avatar === a.avatar && b.field === a.field;
    case 'message':
    case 'message-delete':
      return b.kind === a.kind && b.index === a.index;
    case 'message-insert':
      // Several inserts may share an index.
      return false;
    case 'entry':
      return b.kind === a.kind && b.book === a.book && b.uid === a.uid;
    case 'persona-description':
      return b.kind === a.kind && b.avatarId === a.avatarId;
    case 'lorebook':
      return b.kind === a.kind && b.book === a.book && b.op === a.op;
    case 'character':
      return b.kind === a.kind && b.avatar === a.avatar && b.op === a.op;
  }
}

type EditTarget = Extract<ChangeTarget, { kind: 'character-field' | 'message' | 'entry' | 'persona-description' }>;

function isEdit(change: StagedChange): change is StagedChange & { target: EditTarget } {
  const kind = change.target.kind;
  return kind === 'character-field' || kind === 'message' || kind === 'entry' || kind === 'persona-description';
}

/** The target's current state; null when the target itself is gone (character, message, book or persona). */
type Current = { value: string; entry?: WorldInfoEntry } | null;

async function readCurrent(api: ChangesetAPI, target: EditTarget): Promise<Current> {
  switch (target.kind) {
    case 'character-field': {
      const character = api.character.get(target.avatar);
      if (!character) return null;
      const index = alternateGreetingIndex(target.field);
      if (index === null) {
        return { value: String(character[target.field as keyof typeof character] ?? '') };
      }
      const greetings = character.data?.alternate_greetings ?? [];
      if (index > greetings.length) return null;
      return { value: greetings[index] ?? '' };
    }
    case 'message': {
      const message = api.chat.getMessage(target.index);
      return message ? { value: message.mes } : null;
    }
    case 'entry': {
      const book = await api.worldInfo.getBook(target.book);
      if (!book) return null;
      const entry = book.entries.find((candidate) => candidate.uid === target.uid);
      return entry ? { value: renderEntry(entry), entry } : { value: '' };
    }
    case 'persona-description': {
      const persona = api.persona.getActive();
      return persona && persona.avatarId === target.avatarId ? { value: persona.description } : null;
    }
  }
}

function withTextFields(entry: WorldInfoEntry, source: WorldInfoEntry): WorldInfoEntry {
  return { ...entry, comment: source.comment, key: [...source.key], content: source.content };
}

function bookExists(api: ChangesetAPI, name: string): boolean {
  return api.worldInfo.getAllBookNames().some((header) => header.name === name);
}

function sameMessage(a: Pick<ChatMessage, 'name' | 'mes'> | undefined, b: Pick<ChatMessage, 'name' | 'mes'>) {
  return Boolean(a) && a!.name === b.name && a!.mes === b.mes;
}

export function cardToCharacter(card: Partial<Character>): Character {
  const base = cloneDeep(DEFAULT_CHARACTER);
  return {
    ...base,
    ...cloneDeep(card),
    data: { ...base.data, ...cloneDeep(card.data) } as Character['data'],
  };
}

/**
 * The staged changes of one conversation. It works on the array it's given, so the conversation
 * record (and a reactive copy in the UI) sees every status change.
 */
export class Changeset {
  constructor(public readonly changes: StagedChange[]) {}

  pending(): StagedChange[] {
    return this.changes.filter((change) => change.status === 'pending');
  }

  /** The pending change for the same target, if any. */
  findPending(target: ChangeTarget): StagedChange | undefined {
    return this.changes.find((change) => change.status === 'pending' && sameTarget(change.target, target));
  }

  /**
   * Stages a change and returns its id. A pending change for the same target is replaced in place:
   * it keeps its first `oldValue` (and `entryBefore`, `message`, `bookBefore`). An update of a staged
   * create stays a create, and deleting a staged create drops it. A character create gets the avatar
   * `new:<id>`.
   */
  stage(input: StageInput): string {
    const existing = this.findPending(input.target);
    if (!existing) {
      const change: StagedChange = { id: uuidv4(), status: 'pending', ...input };
      if (change.target.kind === 'character' && change.target.op === 'create') {
        change.target = { ...change.target, avatar: `${NEW_CHARACTER_PREFIX}${change.id}` };
      }
      this.changes.push(change);
      return change.id;
    }

    if (existing.target.kind === 'entry' && input.target.kind === 'entry' && existing.target.op === 'create') {
      if (input.target.op === 'delete') {
        this.changes.splice(this.changes.indexOf(existing), 1);
        return existing.id;
      }
      existing.entryAfter = input.entryAfter;
      existing.newValue = input.newValue;
      existing.label = input.label;
      return existing.id;
    }

    existing.target = input.target;
    existing.label = input.label;
    existing.newValue = input.newValue;
    existing.entryAfter = input.entryAfter;
    existing.card = input.card;
    return existing.id;
  }

  /** Removes a pending change without a trace, for a change that a later staged one makes moot. */
  discard(id: string) {
    const index = this.changes.findIndex((change) => change.id === id && change.status === 'pending');
    if (index !== -1) this.changes.splice(index, 1);
  }

  reject(ids: string[]) {
    for (const change of this.changes) {
      if (ids.includes(change.id) && (change.status === 'pending' || change.status === 'conflict')) {
        change.status = 'rejected';
      }
    }
  }

  /**
   * Applies the given pending changes as one batch. With no ids, every pending change except
   * character deletes, which apply only when their id is given and never join a batch (no undo).
   * A change whose target no longer matches its `oldValue` becomes `conflict` and nothing is
   * written for it.
   */
  async apply(api: ChangesetAPI, ids?: string[]): Promise<StagedChange[]> {
    const selected = this.pending().filter((change) => (ids ? ids.includes(change.id) : !isCharacterDelete(change)));
    const batch = String(this.lastBatch() + 1);
    const applied: StagedChange[] = [];

    for (const change of applyOrder(selected)) {
      if (isEdit(change)) {
        const current = await readCurrent(api, change.target);
        if (!current || current.value !== change.oldValue || !this.entryStateMatches(change, current, 'before')) {
          change.status = 'conflict';
          continue;
        }
        await this.write(api, change, current, 'apply');
      } else {
        if (!(await this.canApplyStructural(api, change))) {
          change.status = 'conflict';
          continue;
        }
        await this.writeStructural(api, change, 'apply');
      }
      change.status = 'applied';
      if (!isCharacterDelete(change)) change.applyBatch = batch;
      applied.push(change);
    }
    return applied;
  }

  /**
   * Reverts the most recent apply batch. All or nothing: when any of its targets no longer
   * matches the applied value, nothing is written and the conflicting changes are returned.
   */
  async undoLast(api: ChangesetAPI): Promise<UndoResult> {
    const batch = String(this.lastBatch());
    const changes = this.changes.filter((change) => change.status === 'applied' && change.applyBatch === batch);
    if (changes.length === 0) return { ok: true, undone: [] };

    const ordered = applyOrder(changes).reverse();
    const conflicts: StagedChange[] = [];

    // Message inserts and deletes are undone first; walk a copy of the chat through them so the
    // checks of the later ones (and of message edits) see the positions their writes will see.
    const history = api.chat.getHistory().map((message) => ({ name: message.name, mes: message.mes }));
    for (const change of ordered) {
      const target = change.target;
      if (target.kind === 'message-insert') {
        if (sameMessage(history[target.index], change.message!)) history.splice(target.index, 1);
        else conflicts.push(change);
      } else if (target.kind === 'message-delete') {
        if (target.index <= history.length) history.splice(target.index, 0, change.message!);
        else conflicts.push(change);
      } else if (target.kind === 'lorebook' && target.op === 'delete') {
        if (bookExists(api, target.book)) conflicts.push(change);
      } else if (target.kind === 'lorebook' && target.op === 'create') {
        if (!(await this.createdBookUndoable(api, change, changes))) conflicts.push(change);
      } else if (target.kind === 'character' && target.op === 'create') {
        const character = api.character.get(target.avatar);
        if (!character || renderCard(character) !== change.newValue) conflicts.push(change);
      }
    }

    // Removed greetings go back first (lowest index first), so the other greeting changes of the
    // batch are checked and reverted at the indexes they were staged with.
    const removals = ordered.filter(isGreetingRemoval);
    const others = ordered.filter((change) => isEdit(change) && !isGreetingRemoval(change));
    const restored = new Map<string, string[]>();
    for (const change of removals) {
      const avatar = (change.target as { avatar: string }).avatar;
      const greetings = restored.get(avatar) ?? [...(api.character.get(avatar)?.data?.alternate_greetings ?? [])];
      const index = greetingIndexOf(change)!;
      if (!api.character.get(avatar) || index > greetings.length) conflicts.push(change);
      else greetings.splice(index, 0, change.oldValue);
      restored.set(avatar, greetings);
    }

    const currents = new Map<StagedChange, Current>();
    for (const change of others) {
      const target = change.target as EditTarget;
      const current = await readCurrent(api, target);
      const index = greetingIndexOf(change);
      const greetings = target.kind === 'character-field' ? restored.get(target.avatar) : undefined;
      let value = current?.value;
      if (index !== null && greetings) value = greetings[index] ?? '';
      if (target.kind === 'message') value = history[target.index]?.mes;
      const exists = target.kind === 'message' ? Boolean(history[target.index]) : Boolean(current);
      if (!exists || value !== change.newValue || (current && !this.entryStateMatches(change, current, 'after'))) {
        conflicts.push(change);
      }
      currents.set(change, current);
    }
    if (conflicts.length > 0) return { ok: false, conflicts };

    for (const change of ordered) {
      if (isGreetingRemoval(change)) await this.write(api, change, { value: '' }, 'undo');
      else if (isEdit(change)) await this.write(api, change, currents.get(change) ?? { value: '' }, 'undo');
      else await this.writeStructural(api, change, 'undo');
    }
    for (const change of changes) {
      change.status = 'pending';
      delete change.applyBatch;
    }
    return { ok: true, undone: changes };
  }

  hasUndo(): boolean {
    return this.lastBatch() > 0;
  }

  private lastBatch(): number {
    return this.changes.reduce(
      (max, change) =>
        change.status === 'applied' && change.applyBatch ? Math.max(max, Number(change.applyBatch)) : max,
      0,
    );
  }

  /** Entries must exist or not as the op expects, which the rendered value alone can't tell for empty text. */
  private entryStateMatches(change: StagedChange, current: NonNullable<Current>, side: 'before' | 'after'): boolean {
    if (change.target.kind !== 'entry') return true;
    const op = change.target.op;
    const shouldExist = side === 'before' ? op !== 'create' : op !== 'delete';
    return Boolean(current.entry) === shouldExist;
  }

  /** A created book can be deleted on undo while it holds only entries that the same batch created. */
  private async createdBookUndoable(api: ChangesetAPI, change: StagedChange, batch: StagedChange[]) {
    const name = (change.target as { book: string }).book;
    if (!bookExists(api, name)) return false;
    const book = await api.worldInfo.getBook(name);
    if (!book) return false;
    const created = new Set(
      batch.flatMap((other) =>
        other.target.kind === 'entry' && other.target.book === name && other.target.op === 'create'
          ? [other.target.uid]
          : [],
      ),
    );
    return book.entries.every((entry) => created.has(entry.uid));
  }

  private async canApplyStructural(api: ChangesetAPI, change: StagedChange): Promise<boolean> {
    const target = change.target;
    switch (target.kind) {
      case 'message-insert':
        return target.index <= api.chat.getHistory().length;
      case 'message-delete':
        return sameMessage(api.chat.getMessage(target.index), change.message!);
      case 'lorebook': {
        if (target.op === 'create') return !bookExists(api, target.book);
        if (!bookExists(api, target.book)) return false;
        const book = await api.worldInfo.getBook(target.book);
        return Boolean(book) && renderBook(book!) === change.oldValue;
      }
      case 'character': {
        if (target.op === 'create') return true;
        const character = api.character.get(target.avatar);
        return Boolean(character) && renderCard(character!) === change.oldValue;
      }
      default:
        throw new Error(`Not a structural change: ${target.kind}`);
    }
  }

  private async writeStructural(api: ChangesetAPI, change: StagedChange, direction: 'apply' | 'undo') {
    const target = change.target;
    switch (target.kind) {
      case 'message-insert':
        if (direction === 'apply') await api.chat.insertMessage(cloneDeep(change.message!), target.index);
        else await api.chat.deleteMessage(target.index);
        return;
      case 'message-delete':
        if (direction === 'apply') await api.chat.deleteMessage(target.index);
        else await api.chat.insertMessage(cloneDeep(change.message!), target.index);
        return;
      case 'lorebook': {
        const creates = (direction === 'apply') === (target.op === 'create');
        if (!creates) await api.worldInfo.deleteBook(target.book);
        else if (target.op === 'create') await api.worldInfo.createBook(target.book);
        else await api.worldInfo.createBook(target.book, cloneDeep(change.bookBefore!));
        return;
      }
      case 'character': {
        if (target.op === 'delete') {
          // No undo: a character delete never joins a batch.
          await api.character.delete(target.avatar, false);
          return;
        }
        if (direction === 'apply') {
          const avatar = await api.character.create(cardToCharacter(change.card ?? {}));
          if (!avatar) throw new Error(`Character "${change.card?.name ?? ''}" could not be created.`);
          change.target = { ...target, avatar };
        } else {
          await api.character.delete(target.avatar, false);
          change.target = { ...target, avatar: `${NEW_CHARACTER_PREFIX}${change.id}` };
        }
        return;
      }
      default:
        throw new Error(`Not a structural change: ${target.kind}`);
    }
  }

  private async write(
    api: ChangesetAPI,
    change: StagedChange,
    current: NonNullable<Current>,
    direction: 'apply' | 'undo',
  ) {
    const target = change.target as EditTarget;
    const value = direction === 'apply' ? change.newValue : change.oldValue;
    switch (target.kind) {
      case 'character-field': {
        const index = alternateGreetingIndex(target.field);
        if (index === null) {
          await api.character.update(target.avatar, { [target.field]: value });
          return;
        }
        // Read fresh: an earlier write in the same apply or undo may have shifted the greetings.
        const greetings = [...(api.character.get(target.avatar)?.data?.alternate_greetings ?? [])];
        if (isGreetingRemoval(change)) {
          if (direction === 'apply') greetings.splice(index, 1);
          else greetings.splice(index, 0, change.oldValue);
        } else if (direction === 'undo' && change.oldValue === '') {
          // Undoing an added greeting removes its slot instead of leaving an empty greeting.
          greetings.splice(index, 1);
        } else {
          greetings[index] = value;
        }
        await api.character.update(target.avatar, { data: { alternate_greetings: greetings } });
        return;
      }
      case 'message':
        await api.chat.updateMessage(target.index, value);
        return;
      case 'persona-description':
        await api.persona.updateActiveField('description', value);
        return;
      case 'entry': {
        const op = target.op;
        const createsEntry = (direction === 'apply' && op === 'create') || (direction === 'undo' && op === 'delete');
        const deletesEntry = (direction === 'apply' && op === 'delete') || (direction === 'undo' && op === 'create');
        if (createsEntry) {
          const entry = direction === 'apply' ? change.entryAfter : change.entryBefore;
          await api.worldInfo.createEntry(target.book, { ...entry! });
        } else if (deletesEntry) {
          await api.worldInfo.deleteEntry(target.book, target.uid);
        } else {
          const source = direction === 'apply' ? change.entryAfter! : change.entryBefore!;
          await api.worldInfo.updateEntry(target.book, withTextFields(current.entry!, source));
        }
        return;
      }
    }
  }
}
