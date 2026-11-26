import type { ExtensionAPI, WorldInfoEntry } from '../../../types';
import type { ToolDefinition } from '../../../types/tools';
import { alternateGreetingIndex, renderEntry, type Changeset } from './changeset';
import {
  CHARACTER_TEXT_FIELDS,
  characterShape,
  clampRange,
  entryShape,
  messageShape,
  personaShape,
  type CharacterTextField,
} from './shapes';

export type ToolsAPI = {
  character: Pick<ExtensionAPI['character'], 'getAll' | 'get'>;
  chat: Pick<ExtensionAPI['chat'], 'getHistory' | 'getMessage'>;
  worldInfo: Pick<ExtensionAPI['worldInfo'], 'getAllBookNames' | 'getBook' | 'createDefaultEntry'>;
  persona: Pick<ExtensionAPI['persona'], 'getActive'>;
};

type ToolResult = Record<string, unknown> | unknown[];

const error = (message: string) => ({ error: message });

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const int = (description?: string) => ({ type: 'integer', ...(description ? { description } : {}) });

function tool(
  name: string,
  description: string,
  parameters: object,
  action: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult,
): ToolDefinition {
  return { name, description, parameters, action };
}

/** The assistant's read and propose-edit tools. Edit tools only stage changes in `changeset`. */
export function createAssistantTools(api: ToolsAPI, changeset: Changeset): ToolDefinition[] {
  const findCharacter = (avatar: unknown) => api.character.get(String(avatar));

  /** Only listed books: `getBook` on an unknown name returns an empty book from the backend, not null. */
  async function findBook(name: unknown) {
    const wanted = String(name);
    const listed = api.worldInfo.getAllBookNames().some((book) => book.name === wanted || book.file_id === wanted);
    return listed ? api.worldInfo.getBook(wanted) : null;
  }

  /** The entry as the conversation sees it: a pending create or update wins over the book. */
  function pendingEntryChange(book: string, uid: number) {
    return changeset.findPending({ kind: 'entry', book, uid, op: 'update' });
  }

  return [
    tool('list_characters', 'List all characters.', objectSchema({}), () =>
      api.character.getAll().map((character) => ({ avatar: character.avatar, name: character.name })),
    ),

    tool(
      'get_character',
      'Read a character card. alternate_greetings is 1-based in edit_character_field.',
      objectSchema({ avatar: str() }, ['avatar']),
      ({ avatar }) => {
        const character = findCharacter(avatar);
        return character ? characterShape(character) : error(`Unknown character avatar: ${avatar}`);
      },
    ),

    tool('list_lorebooks', 'List all lorebook names.', objectSchema({}), () =>
      api.worldInfo.getAllBookNames().map((header) => header.name),
    ),

    tool(
      'get_lorebook',
      'Read all entries of a lorebook.',
      objectSchema({ book: str() }, ['book']),
      async ({ book }) => {
        const found = await findBook(book);
        return found ? found.entries.map(entryShape) : error(`Unknown lorebook: ${book}`);
      },
    ),

    tool(
      'get_messages',
      'Read chat messages by 0-based index, inclusive.',
      objectSchema({ from: int(), to: int() }, ['from', 'to']),
      ({ from, to }) => {
        const history = api.chat.getHistory();
        const range = clampRange(Number(from), Number(to), history.length);
        if (!range) return [];
        return history
          .slice(range.from, range.to + 1)
          .map((message, offset) => messageShape(message, range.from + offset));
      },
    ),

    tool('get_persona', "Read the user's active persona.", objectSchema({}), () => {
      const persona = api.persona.getActive();
      return persona ? personaShape(persona) : error('No active persona');
    }),

    tool(
      'edit_character_field',
      'Propose a new value for a character field. field: description, personality, scenario, first_mes, mes_example or alternate_greetings.<n> (1-based; n = count + 1 adds one; an empty value removes that greeting and later ones shift up). Use the numbers from the card as it is now, also when removing several.',
      objectSchema({ avatar: str(), field: str(), value: str() }, ['avatar', 'field', 'value']),
      ({ avatar, field, value }) => {
        const character = findCharacter(avatar);
        if (!character) return error(`Unknown character avatar: ${avatar}`);
        const fieldName = String(field);
        const greetingIndex = alternateGreetingIndex(fieldName);
        let oldValue: string;
        let label: string;

        if (greetingIndex === null) {
          if (!CHARACTER_TEXT_FIELDS.includes(fieldName as CharacterTextField)) return error(`Bad field: ${fieldName}`);
          oldValue = character[fieldName as CharacterTextField] ?? '';
          label = `${character.name}: ${fieldName}`;
        } else {
          const greetings = character.data?.alternate_greetings ?? [];
          // Pending appends count, so several new greetings can be staged in a row.
          const known = Math.max(greetings.length, highestPendingGreeting(changeset, character.avatar));
          if (greetingIndex < 0 || greetingIndex > known) {
            return error(`Bad field: ${fieldName} (the character has ${greetings.length} alternate greetings)`);
          }
          if (String(value) === '' && greetingIndex >= greetings.length) {
            return error(`${fieldName} isn't saved yet, so there is nothing to remove`);
          }
          oldValue = greetings[greetingIndex] ?? '';
          label = `${character.name}: alternate greeting ${greetingIndex + 1}`;
        }

        const id = changeset.stage({
          target: { kind: 'character-field', avatar: character.avatar, field: fieldName },
          label,
          oldValue,
          newValue: String(value),
        });
        return { staged: id };
      },
    ),

    tool(
      'edit_message',
      'Propose new text for a chat message by 0-based index.',
      objectSchema({ index: int(), value: str() }, ['index', 'value']),
      ({ index, value }) => {
        const messageIndex = Number(index);
        const message = Number.isInteger(messageIndex) ? api.chat.getMessage(messageIndex) : undefined;
        if (!message) return error(`Unknown message index: ${index}`);
        const id = changeset.stage({
          target: { kind: 'message', index: messageIndex },
          label: `Message #${messageIndex} (${message.name})`,
          oldValue: message.mes,
          newValue: String(value),
        });
        return { staged: id };
      },
    ),

    tool(
      'upsert_entry',
      'Propose a lorebook entry change. Without uid, creates an entry and returns its uid. With uid, changes only the given fields.',
      objectSchema(
        { book: str(), uid: int(), comment: str('Title'), key: { type: 'array', items: str() }, content: str() },
        ['book'],
      ),
      async (args) => {
        const book = await findBook(args.book);
        if (!book) return error(`Unknown lorebook: ${args.book}`);
        const fields = textFields(args);

        if (args.uid === undefined || args.uid === null) {
          const uid = nextUid(book.entries, changeset, book.name);
          const entryAfter = { ...api.worldInfo.createDefaultEntry(uid), comment: '', key: [], content: '', ...fields };
          const id = changeset.stage({
            target: { kind: 'entry', book: book.name, uid, op: 'create' },
            label: entryLabel(book.name, entryAfter),
            oldValue: '',
            newValue: renderEntry(entryAfter),
            entryAfter,
          });
          return { staged: id, uid };
        }

        const uid = Number(args.uid);
        const pending = pendingEntryChange(book.name, uid);
        if (pending?.target.kind === 'entry' && pending.target.op === 'delete') {
          return error(`Entry ${uid} is already staged for deletion`);
        }
        const current = book.entries.find((entry) => entry.uid === uid);
        const base = pending?.entryAfter ?? current;
        if (!base) return error(`Unknown entry uid ${uid} in ${book.name}`);

        const entryAfter: WorldInfoEntry = { ...base, ...fields };
        const id = changeset.stage({
          target: { kind: 'entry', book: book.name, uid, op: 'update' },
          label: entryLabel(book.name, entryAfter),
          oldValue: current ? renderEntry(current) : '',
          newValue: renderEntry(entryAfter),
          entryBefore: current,
          entryAfter,
        });
        return { staged: id };
      },
    ),

    tool(
      'delete_entry',
      'Propose deleting a lorebook entry.',
      objectSchema({ book: str(), uid: int() }, ['book', 'uid']),
      async (args) => {
        const book = await findBook(args.book);
        if (!book) return error(`Unknown lorebook: ${args.book}`);
        const uid = Number(args.uid);
        const pending = pendingEntryChange(book.name, uid);
        const current = book.entries.find((entry) => entry.uid === uid);
        const shown = pending?.entryAfter ?? current;
        if (!shown) return error(`Unknown entry uid ${uid} in ${book.name}`);

        const id = changeset.stage({
          target: { kind: 'entry', book: book.name, uid, op: 'delete' },
          label: entryLabel(book.name, shown),
          oldValue: current ? renderEntry(current) : '',
          newValue: '',
          entryBefore: current,
        });
        return { staged: id };
      },
    ),

    tool(
      'edit_persona_description',
      "Propose a new description for the user's active persona.",
      objectSchema({ value: str() }, ['value']),
      ({ value }) => {
        const persona = api.persona.getActive();
        if (!persona) return error('No active persona');
        const id = changeset.stage({
          target: { kind: 'persona-description', avatarId: persona.avatarId },
          label: `${persona.name}: description`,
          oldValue: persona.description,
          newValue: String(value),
        });
        return { staged: id };
      },
    ),
  ];
}

function textFields(args: Record<string, unknown>): Partial<Pick<WorldInfoEntry, 'comment' | 'key' | 'content'>> {
  const fields: Partial<Pick<WorldInfoEntry, 'comment' | 'key' | 'content'>> = {};
  if (args.comment !== undefined) fields.comment = String(args.comment);
  if (Array.isArray(args.key)) fields.key = args.key.map(String);
  if (args.content !== undefined) fields.content = String(args.content);
  return fields;
}

function entryLabel(book: string, entry: Pick<WorldInfoEntry, 'uid' | 'comment'>): string {
  return `${book}: ${entry.comment || `#${entry.uid}`}`;
}

/** Max uid in the book and among its pending creates, plus one. */
function nextUid(entries: WorldInfoEntry[], changeset: Changeset, book: string): number {
  const pendingUids = changeset
    .pending()
    .flatMap((change) => (change.target.kind === 'entry' && change.target.book === book ? [change.target.uid] : []));
  return Math.max(-1, ...entries.map((entry) => entry.uid), ...pendingUids) + 1;
}

/** The highest 1-based alternate greeting number with a pending change for this character. */
function highestPendingGreeting(changeset: Changeset, avatar: string): number {
  return changeset.pending().reduce((max, change) => {
    if (change.target.kind !== 'character-field' || change.target.avatar !== avatar) return max;
    const index = alternateGreetingIndex(change.target.field);
    return index === null ? max : Math.max(max, index + 1);
  }, 0);
}
