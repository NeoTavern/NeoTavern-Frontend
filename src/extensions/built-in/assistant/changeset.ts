import type { ExtensionAPI, WorldInfoEntry } from '../../../types';
import { uuidv4 } from '../../../utils/commons';

export type ChangeTarget =
  | { kind: 'character-field'; avatar: string; field: string }
  | { kind: 'message'; index: number }
  | { kind: 'entry'; book: string; uid: number; op: 'create' | 'update' | 'delete' }
  | { kind: 'persona-description'; avatarId: string };

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
  /** Set when applied. Batches are numbered "1", "2", … within a conversation. */
  applyBatch?: string;
}

export type StageInput = Pick<
  StagedChange,
  'target' | 'label' | 'oldValue' | 'newValue' | 'entryBefore' | 'entryAfter'
>;

export type ChangesetAPI = {
  character: Pick<ExtensionAPI['character'], 'get' | 'update'>;
  chat: Pick<ExtensionAPI['chat'], 'getMessage' | 'updateMessage'>;
  worldInfo: Pick<ExtensionAPI['worldInfo'], 'getBook' | 'createEntry' | 'updateEntry' | 'deleteEntry'>;
  persona: Pick<ExtensionAPI['persona'], 'getActive' | 'updateActiveField'>;
};

export type UndoResult = { ok: true; undone: StagedChange[] } | { ok: false; conflicts: StagedChange[] };

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

/** Removals after everything else, highest index first, so every staged greeting index stays valid. */
function applyOrder(changes: StagedChange[]): StagedChange[] {
  const removals = changes.filter(isGreetingRemoval).sort((a, b) => greetingIndexOf(b)! - greetingIndexOf(a)!);
  return [...changes.filter((change) => !isGreetingRemoval(change)), ...removals];
}

/** The readable form of an entry shown in diffs and compared for conflicts. */
export function renderEntry(entry: Pick<WorldInfoEntry, 'comment' | 'key' | 'content'>): string {
  return `Title: ${entry.comment}\nKeys: ${entry.key.join(', ')}\n\n${entry.content}`;
}

function sameTarget(a: ChangeTarget, b: ChangeTarget): boolean {
  switch (a.kind) {
    case 'character-field':
      return b.kind === a.kind && b.avatar === a.avatar && b.field === a.field;
    case 'message':
      return b.kind === a.kind && b.index === a.index;
    case 'entry':
      return b.kind === a.kind && b.book === a.book && b.uid === a.uid;
    case 'persona-description':
      return b.kind === a.kind && b.avatarId === a.avatarId;
  }
}

/** The target's current state; null when the target itself is gone (character, message, book or persona). */
type Current = { value: string; entry?: WorldInfoEntry } | null;

async function readCurrent(api: ChangesetAPI, target: ChangeTarget): Promise<Current> {
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
   * it keeps its first `oldValue` (and `entryBefore`). An update of a staged create stays a create,
   * and deleting a staged create drops it.
   */
  stage(input: StageInput): string {
    const existing = this.findPending(input.target);
    if (!existing) {
      const change: StagedChange = { id: uuidv4(), status: 'pending', ...input };
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
    return existing.id;
  }

  reject(ids: string[]) {
    for (const change of this.changes) {
      if (ids.includes(change.id) && (change.status === 'pending' || change.status === 'conflict')) {
        change.status = 'rejected';
      }
    }
  }

  /**
   * Applies the given pending changes (all pending ones by default) as one batch. A change whose
   * target no longer matches its `oldValue` becomes `conflict` and nothing is written for it.
   */
  async apply(api: ChangesetAPI, ids?: string[]): Promise<StagedChange[]> {
    const selected = this.pending().filter((change) => !ids || ids.includes(change.id));
    const batch = String(this.lastBatch() + 1);
    const applied: StagedChange[] = [];

    for (const change of applyOrder(selected)) {
      const current = await readCurrent(api, change.target);
      if (!current || current.value !== change.oldValue || !this.entryStateMatches(change, current, 'before')) {
        change.status = 'conflict';
        continue;
      }
      await this.write(api, change, current, 'apply');
      change.status = 'applied';
      change.applyBatch = batch;
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

    // Removed greetings go back first (lowest index first), so the other greeting changes of the
    // batch are checked and reverted at the indexes they were staged with.
    const removals = changes.filter(isGreetingRemoval).sort((a, b) => greetingIndexOf(a)! - greetingIndexOf(b)!);
    const others = changes.filter((change) => !isGreetingRemoval(change));
    const restored = new Map<string, string[]>();
    const conflicts: StagedChange[] = [];
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
      const current = await readCurrent(api, change.target);
      const index = greetingIndexOf(change);
      const greetings = change.target.kind === 'character-field' ? restored.get(change.target.avatar) : undefined;
      const value = index !== null && greetings ? (greetings[index] ?? '') : current?.value;
      if (!current || value !== change.newValue || !this.entryStateMatches(change, current, 'after')) {
        conflicts.push(change);
      }
      currents.set(change, current);
    }
    if (conflicts.length > 0) return { ok: false, conflicts };

    for (const change of removals) await this.write(api, change, { value: '' }, 'undo');
    // Reverse order, so an earlier write in the batch is restored last.
    for (const change of [...others].reverse()) await this.write(api, change, currents.get(change)!, 'undo');
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

  private async write(
    api: ChangesetAPI,
    change: StagedChange,
    current: NonNullable<Current>,
    direction: 'apply' | 'undo',
  ) {
    const target = change.target;
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
