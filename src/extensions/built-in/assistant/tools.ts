import { default_user_avatar } from '../../../constants';
import type { Character, ChatMessage, ExtensionAPI, WorldInfoBook, WorldInfoEntry } from '../../../types';
import type { ToolDefinition } from '../../../types/tools';
import { getThumbnailUrl } from '../../../utils/character';
import { getMessageTimeStamp } from '../../../utils/commons';
import {
  alternateGreetingIndex,
  cardToCharacter,
  NEW_CHARACTER_PREFIX,
  renderBook,
  renderCard,
  renderEntry,
  type Changeset,
  type StagedChange,
} from './changeset';
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
  character: Pick<ExtensionAPI['character'], 'getAll' | 'get' | 'getActives'>;
  chat: Pick<ExtensionAPI['chat'], 'getHistory' | 'getMessage' | 'getChatInfo'>;
  worldInfo: Pick<ExtensionAPI['worldInfo'], 'getAllBookNames' | 'getBook' | 'createDefaultEntry'>;
  persona: Pick<ExtensionAPI['persona'], 'getActive'>;
  settings: Pick<ExtensionAPI['settings'], 'getGlobal'>;
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

  /** The pending create of a `new:<id>` character. */
  function stagedCharacter(avatar: unknown): StagedChange | undefined {
    const wanted = String(avatar);
    if (!wanted.startsWith(NEW_CHARACTER_PREFIX)) return undefined;
    return changeset.findPending({ kind: 'character', avatar: wanted, op: 'create' });
  }

  const characterDeleteStaged = (avatar: string) =>
    Boolean(changeset.findPending({ kind: 'character', avatar, op: 'delete' }));

  const bookCreateStaged = (name: string) =>
    Boolean(changeset.findPending({ kind: 'lorebook', book: name, op: 'create' }));
  const bookDeleteStaged = (name: string) =>
    Boolean(changeset.findPending({ kind: 'lorebook', book: name, op: 'delete' }));

  /**
   * A listed book, or an empty one staged for creation. Only listed books: `getBook` on an unknown
   * name returns an empty book from the backend, not null.
   */
  async function findBook(name: unknown): Promise<WorldInfoBook | { error: string }> {
    const wanted = String(name);
    const listed = api.worldInfo.getAllBookNames().find((book) => book.name === wanted || book.file_id === wanted);
    if (!listed) return bookCreateStaged(wanted) ? { name: wanted, entries: [] } : error(`Unknown lorebook: ${wanted}`);
    if (bookDeleteStaged(listed.name)) return error(`Lorebook ${listed.name} is staged for deletion`);
    return (await api.worldInfo.getBook(wanted)) ?? error(`Unknown lorebook: ${wanted}`);
  }

  /** The entry as the conversation sees it: a pending create or update wins over the book. */
  function pendingEntryChange(book: string, uid: number) {
    return changeset.findPending({ kind: 'entry', book, uid, op: 'update' });
  }

  const mergesToolMessages = () => api.settings.getGlobal('chat.mergeToolMessages');

  /** Edits a field of a character staged for creation on its card. */
  function editStagedCard(create: StagedChange, field: string, value: string): ToolResult {
    const card: Partial<Character> = { ...create.card };
    const greetings = [...(create.card?.data?.alternate_greetings ?? [])];
    const greetingIndex = alternateGreetingIndex(field);
    if (greetingIndex === null) {
      if (!CHARACTER_TEXT_FIELDS.includes(field as CharacterTextField)) return error(`Bad field: ${field}`);
      card[field as CharacterTextField] = value;
    } else {
      if (greetingIndex < 0 || greetingIndex > greetings.length) {
        return error(`Bad field: ${field} (the character has ${greetings.length} alternate greetings)`);
      }
      if (value === '') {
        if (greetingIndex === greetings.length) return error(`${field} doesn't exist, so there is nothing to remove`);
        greetings.splice(greetingIndex, 1);
      } else {
        greetings[greetingIndex] = value;
      }
    }
    card.data = { ...card.data, alternate_greetings: greetings } as Character['data'];
    const id = changeset.stage({
      target: create.target,
      label: create.label,
      oldValue: '',
      newValue: renderCard(card),
      card,
    });
    return { staged: id };
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
        const create = stagedCharacter(avatar);
        if (create) return characterShape(cardToCharacter({ ...create.card, avatar: String(avatar) }));
        const character = findCharacter(avatar);
        return character ? characterShape(character) : error(`Unknown character avatar: ${avatar}`);
      },
    ),

    tool('list_lorebooks', 'List all lorebook names, including ones staged for creation.', objectSchema({}), () => [
      ...api.worldInfo.getAllBookNames().map((header) => header.name),
      ...changeset
        .pending()
        .flatMap((change) =>
          change.target.kind === 'lorebook' && change.target.op === 'create' ? [change.target.book] : [],
        ),
    ]),

    tool(
      'get_lorebook',
      'Read all entries of a lorebook.',
      objectSchema({ book: str() }, ['book']),
      async ({ book }) => {
        const found = await findBook(book);
        return 'error' in found ? found : found.entries.map(entryShape);
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
        const create = stagedCharacter(avatar);
        if (create) return editStagedCard(create, String(field), String(value));
        const character = findCharacter(avatar);
        if (!character) return error(`Unknown character avatar: ${avatar}`);
        if (characterDeleteStaged(character.avatar)) return error(`${character.name} is staged for deletion`);
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
      'create_character',
      'Propose a new character. Returns its avatar (new:<id>) for get_character and edit_character_field, which also adds alternate greetings.',
      objectSchema(
        {
          name: str(),
          description: str(),
          personality: str(),
          scenario: str(),
          first_mes: str(),
          mes_example: str(),
        },
        ['name'],
      ),
      (args) => {
        const name = String(args.name ?? '').trim();
        if (!name) return error('A character needs a name');
        const card: Partial<Character> = { name, data: { alternate_greetings: [] } as unknown as Character['data'] };
        for (const field of CHARACTER_TEXT_FIELDS) {
          if (args[field] !== undefined) card[field] = String(args[field]);
        }
        const id = changeset.stage({
          target: { kind: 'character', avatar: '', op: 'create' },
          label: name,
          oldValue: '',
          newValue: renderCard(card),
          card,
        });
        const staged = changeset.changes.find((change) => change.id === id)!;
        return { staged: id, avatar: (staged.target as { avatar: string }).avatar };
      },
    ),

    tool(
      'delete_character',
      'Propose deleting a character (its chats stay). The user must accept it on its own, and it cannot be undone.',
      objectSchema({ avatar: str() }, ['avatar']),
      ({ avatar }) => {
        if (stagedCharacter(avatar)) return error(`${avatar} isn't created yet, so there is nothing to delete`);
        const character = findCharacter(avatar);
        if (!character) return error(`Unknown character avatar: ${avatar}`);
        const id = changeset.stage({
          target: { kind: 'character', avatar: character.avatar, op: 'delete' },
          label: character.name,
          oldValue: renderCard(character),
          newValue: '',
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
        if (changeset.findPending({ kind: 'message-delete', index: messageIndex })) {
          return error(`Message #${messageIndex} is staged for deletion`);
        }
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
      'insert_message',
      'Propose a new chat message. index: the 0-based position it takes in the chat as it is now (chat length appends). role user speaks as the active persona; role character as the given character avatar, or the first active character.',
      objectSchema(
        { index: int(), role: { type: 'string', enum: ['user', 'character'] }, character: str(), value: str() },
        ['index', 'role', 'value'],
      ),
      ({ index, role, character, value }) => {
        if (!api.chat.getChatInfo()) return error('No open chat');
        const history = api.chat.getHistory();
        const position = Number(index);
        if (!Number.isInteger(position) || position < 0 || position > history.length) {
          return error(`Bad index: ${index} (the chat has ${history.length} messages)`);
        }
        const speaker = messageSpeaker(api, role, character);
        if ('error' in speaker) return speaker;
        // Undoing it deletes the message, and with merged tool messages that would take a tool chain with it.
        if (role === 'character' && mergesToolMessages() && position > 0 && isToolChainLink(history[position - 1])) {
          return error(`Bad index: ${position} (a character message can't follow a tool call message)`);
        }

        const text = String(value);
        const now = getMessageTimeStamp();
        const message: ChatMessage = {
          ...speaker,
          is_system: false,
          mes: text,
          send_date: now,
          extra: {},
          swipe_id: 0,
          swipe_info: [{ extra: {}, send_date: now }],
          swipes: [text],
        };
        const id = changeset.stage({
          target: { kind: 'message-insert', index: position },
          label: `New message #${position} (${message.name})`,
          oldValue: '',
          newValue: text,
          message,
        });
        return { staged: id };
      },
    ),

    tool(
      'delete_message',
      'Propose deleting a chat message by 0-based index.',
      objectSchema({ index: int() }, ['index']),
      ({ index }) => {
        const messageIndex = Number(index);
        const message = Number.isInteger(messageIndex) ? api.chat.getMessage(messageIndex) : undefined;
        if (!message) return error(`Unknown message index: ${index}`);
        if (mergesToolMessages() && endsToolChain(api.chat.getHistory(), messageIndex)) {
          return error(`Message #${messageIndex} ends a tool call chain and can't be deleted alone`);
        }
        // A pending edit of the message would make the delete conflict; the delete makes it moot.
        const edit = changeset.findPending({ kind: 'message', index: messageIndex });
        if (edit) changeset.discard(edit.id);
        const id = changeset.stage({
          target: { kind: 'message-delete', index: messageIndex },
          label: `Message #${messageIndex} (${message.name})`,
          oldValue: message.mes,
          newValue: '',
          message,
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
        if ('error' in book) return book;
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
        if ('error' in book) return book;
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
      'create_lorebook',
      'Propose a new, empty lorebook. Add entries with upsert_entry using its name.',
      objectSchema({ name: str() }, ['name']),
      ({ name }) => {
        const bookName = String(name ?? '').trim();
        if (!bookName) return error('A lorebook needs a name');
        if (api.worldInfo.getAllBookNames().some((header) => header.name === bookName) || bookCreateStaged(bookName)) {
          return error(`A lorebook named ${bookName} already exists`);
        }
        const id = changeset.stage({
          target: { kind: 'lorebook', book: bookName, op: 'create' },
          label: bookName,
          oldValue: '',
          newValue: renderBook({ name: bookName, entries: [] }),
        });
        return { staged: id };
      },
    ),

    tool(
      'delete_lorebook',
      'Propose deleting a lorebook with all its entries.',
      objectSchema({ book: str() }, ['book']),
      async ({ book }) => {
        const wanted = String(book);
        if (bookCreateStaged(wanted)) return error(`${wanted} isn't created yet, so there is nothing to delete`);
        const found = await findBook(wanted);
        if ('error' in found) return found;
        const hasEntryChanges = changeset
          .pending()
          .some((change) => change.target.kind === 'entry' && change.target.book === found.name);
        if (hasEntryChanges) return error(`${found.name} has pending entry changes; they must be resolved first`);
        const id = changeset.stage({
          target: { kind: 'lorebook', book: found.name, op: 'delete' },
          label: found.name,
          oldValue: renderBook(found),
          newValue: '',
          bookBefore: found,
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

/** Who an inserted message is from, in `chat.createMessage`'s message shape. */
function messageSpeaker(
  api: ToolsAPI,
  role: unknown,
  avatar: unknown,
): Pick<ChatMessage, 'name' | 'is_user' | 'original_avatar' | 'force_avatar'> | { error: string } {
  if (role === 'user') {
    const persona = api.persona.getActive();
    if (!persona) return error('No active persona');
    return {
      name: persona.name,
      is_user: true,
      original_avatar: persona.avatarId,
      force_avatar: getThumbnailUrl('persona', persona.avatarId || default_user_avatar),
    };
  }
  if (role !== 'character') return error(`Bad role: ${role}`);
  const character = avatar ? api.character.get(String(avatar)) : (api.character.getActives()[0] ?? null);
  if (!character) return error(avatar ? `Unknown character avatar: ${avatar}` : 'No active character');
  return { name: character.name, is_user: false, original_avatar: character.avatar };
}

/** A tool call message or a tool result: what `findToolChainStart` walks back over. */
function isToolChainLink(message: ChatMessage | undefined): boolean {
  if (!message) return false;
  if (message.is_system) return true;
  return !message.is_user && (message.extra?.tool_invocations?.length ?? 0) > 0;
}

/** Whether deleting this message would delete a merged tool chain with it (as `chat.store.deleteMessage` does). */
function endsToolChain(history: ChatMessage[], index: number): boolean {
  const message = history[index];
  return !message.is_user && !message.is_system && index > 0 && isToolChainLink(history[index - 1]);
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
