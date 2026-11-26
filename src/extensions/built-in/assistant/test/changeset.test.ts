import { describe, expect, test } from 'vitest';
import type { Character, ChatMessage } from '../../../../types';
import { Changeset, renderBook, renderCard, renderEntry, type StagedChange } from '../changeset';
import { createAssistantTools } from '../tools';
import { entry, fakeDataApi, type FakeDataApi } from '../test-support/fake-data-api';

function setup(options: Parameters<typeof fakeDataApi>[0]) {
  const api = fakeDataApi(options);
  const changes: StagedChange[] = [];
  const changeset = new Changeset(changes);
  const tools = Object.fromEntries(createAssistantTools(api, changeset).map((tool) => [tool.name, tool.action]));
  return { api, changes, changeset, tools };
}

const hazel = {
  avatar: 'hazel.png',
  name: 'Hazel',
  first_mes: 'Hello there, traveler.',
  data: { alternate_greetings: ['Hi.'] },
};

describe('changeset', () => {
  test('restaging the same target replaces newValue and keeps the first oldValue', async () => {
    const { api, changes, tools } = setup({ characters: [hazel] });

    await tools.edit_character_field({ avatar: 'hazel.png', field: 'first_mes', value: 'Hello.' });
    api.store.characters[0].first_mes = 'Changed meanwhile';
    await tools.edit_character_field({ avatar: 'hazel.png', field: 'first_mes', value: 'Hey.' });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ oldValue: 'Hello there, traveler.', newValue: 'Hey.', status: 'pending' });
  });

  test('a target changed after staging becomes a conflict and nothing is written', async () => {
    const { api, changes, changeset, tools } = setup({
      characters: [hazel],
      history: [{ name: 'Hazel', is_user: false, mes: 'One' }],
    });
    await tools.edit_message({ index: 0, value: 'Uno' });
    await tools.edit_character_field({ avatar: 'hazel.png', field: 'first_mes', value: 'Hey.' });
    api.store.history[0].mes = 'One, edited by the user';

    const applied = await changeset.apply(api);

    expect(changes.map((change) => change.status)).toEqual(['conflict', 'applied']);
    expect(applied).toHaveLength(1);
    expect(api.chat.updateMessage).not.toHaveBeenCalled();
    expect(api.store.history[0].mes).toBe('One, edited by the user');
  });

  test('undo restores an updated field, deletes a created entry and recreates a deleted one', async () => {
    const original = entry(3, { comment: 'Castle', key: ['castle'], content: 'A ruin.', order: 7 });
    const doomed = entry(5, { comment: 'Duplicate', key: ['dup'], content: 'Same.' });
    const { api, changes, changeset, tools } = setup({
      characters: [hazel],
      books: [{ name: 'Eldoria', entries: [original, doomed] }],
    });
    await tools.edit_character_field({ avatar: 'hazel.png', field: 'first_mes', value: 'Hey.' });
    await tools.upsert_entry({ book: 'Eldoria', content: 'A new town.', comment: 'Town' });
    await tools.upsert_entry({ book: 'Eldoria', uid: 3, content: 'A restored castle.' });
    await tools.delete_entry({ book: 'Eldoria', uid: 5 });

    await changeset.apply(api);
    const book = () => api.store.books[0].entries;
    expect(
      book()
        .map((candidate) => candidate.uid)
        .sort(),
    ).toEqual([3, 6]);
    expect(book().find((candidate) => candidate.uid === 3)).toMatchObject({ content: 'A restored castle.', order: 7 });

    const result = await changeset.undoLast(api);

    expect(result.ok).toBe(true);
    expect(api.store.characters[0].first_mes).toBe('Hello there, traveler.');
    expect(
      book()
        .map((candidate) => candidate.uid)
        .sort(),
    ).toEqual([3, 5]);
    expect(book().find((candidate) => candidate.uid === 3)).toEqual(original);
    expect(book().find((candidate) => candidate.uid === 5)).toEqual(doomed);
    expect(changes.every((change) => change.status === 'pending' && !change.applyBatch)).toBe(true);
  });

  test('undo reverts only the most recent batch', async () => {
    const { api, changes, changeset, tools } = setup({
      history: [
        { name: 'A', is_user: false, mes: 'one' },
        { name: 'B', is_user: true, mes: 'two' },
      ],
    });
    await tools.edit_message({ index: 0, value: 'ONE' });
    await changeset.apply(api);
    await tools.edit_message({ index: 1, value: 'TWO' });
    await changeset.apply(api);

    await changeset.undoLast(api);

    expect(api.store.history.map((message) => message.mes)).toEqual(['ONE', 'two']);
    expect(changes.map((change) => change.status)).toEqual(['applied', 'pending']);
  });

  test('undo writes nothing when a target changed after applying', async () => {
    const { api, changeset, tools } = setup({ history: [{ name: 'A', is_user: false, mes: 'one' }] });
    await tools.edit_message({ index: 0, value: 'ONE' });
    await changeset.apply(api);
    api.store.history[0].mes = 'edited by the user';
    api.chat.updateMessage.mockClear();

    const result = await changeset.undoLast(api);

    expect(result.ok).toBe(false);
    expect(api.chat.updateMessage).not.toHaveBeenCalled();
  });

  test('alternate_greetings.<count + 1> appends, and undo removes the appended greeting', async () => {
    const { api, changeset, tools } = setup({ characters: [hazel] });

    expect(
      await tools.edit_character_field({ avatar: 'hazel.png', field: 'alternate_greetings.2', value: 'Yo.' }),
    ).toHaveProperty('staged');
    await changeset.apply(api);
    expect(api.store.characters[0].data?.alternate_greetings).toEqual(['Hi.', 'Yo.']);

    await changeset.undoLast(api);
    expect(api.store.characters[0].data?.alternate_greetings).toEqual(['Hi.']);
  });

  test('an empty greeting removes it, alongside an edit staged with the old numbering, and undo restores both', async () => {
    const greetings = ['G1', 'G2', 'G3', 'G4'];
    const { api, changeset, tools } = setup({ characters: [{ ...hazel, data: { alternate_greetings: greetings } }] });
    await tools.edit_character_field({ avatar: 'hazel.png', field: 'alternate_greetings.2', value: '' });
    await tools.edit_character_field({ avatar: 'hazel.png', field: 'alternate_greetings.4', value: 'G4 edited' });

    const applied = await changeset.apply(api);
    expect(applied).toHaveLength(2);
    expect(api.store.characters[0].data?.alternate_greetings).toEqual(['G1', 'G3', 'G4 edited']);

    expect((await changeset.undoLast(api)).ok).toBe(true);
    expect(api.store.characters[0].data?.alternate_greetings).toEqual(greetings);
  });

  test('removing a greeting that is not saved yet is a tool error', async () => {
    const { changes, tools } = setup({ characters: [hazel] });

    expect(
      await tools.edit_character_field({ avatar: 'hazel.png', field: 'alternate_greetings.2', value: '' }),
    ).toHaveProperty('error');
    expect(changes).toHaveLength(0);
  });
});

function chatOf(...texts: string[]) {
  return texts.map((mes, index) => ({ name: index % 2 ? 'User' : 'Hazel', is_user: index % 2 === 1, mes }));
}

function message(name: string, mes: string) {
  return { name, mes, is_user: false, is_system: false } as ChatMessage;
}

function stageMessageDelete(changeset: Changeset, api: FakeDataApi, index: number) {
  const removed = api.store.history[index];
  return changeset.stage({
    target: { kind: 'message-delete', index },
    label: `#${index}`,
    oldValue: removed.mes,
    newValue: '',
    message: structuredClone(removed),
  });
}

function stageMessageInsert(changeset: Changeset, index: number, inserted: ChatMessage) {
  return changeset.stage({
    target: { kind: 'message-insert', index },
    label: `#${index}`,
    oldValue: '',
    newValue: inserted.mes,
    message: inserted,
  });
}

describe('changeset create and delete', () => {
  test('two message deletes staged together remove the right messages, and undo puts both back', async () => {
    const { api, changeset } = setup({ history: chatOf('m0', 'm1', 'm2', 'm3', 'm4', 'm5') });
    stageMessageDelete(changeset, api, 3);
    stageMessageDelete(changeset, api, 4);

    await changeset.apply(api);
    expect(api.store.history.map((m) => m.mes)).toEqual(['m0', 'm1', 'm2', 'm5']);

    expect((await changeset.undoLast(api)).ok).toBe(true);
    expect(api.store.history.map((m) => m.mes)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
  });

  test('inserts and a delete staged in one batch land at the staged positions, and undo restores the chat', async () => {
    const { api, changeset } = setup({ history: chatOf('m0', 'm1', 'm2', 'm3') });
    stageMessageInsert(changeset, 3, message('Hazel', 'x'));
    stageMessageInsert(changeset, 3, message('Hazel', 'y'));
    stageMessageDelete(changeset, api, 1);
    stageMessageInsert(changeset, 1, message('Hazel', 'z'));

    await changeset.apply(api);
    expect(api.store.history.map((m) => m.mes)).toEqual(['m0', 'z', 'm2', 'x', 'y', 'm3']);

    expect((await changeset.undoLast(api)).ok).toBe(true);
    expect(api.store.history.map((m) => m.mes)).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  test('a message edit staged with a later delete is checked and undone at its own index', async () => {
    const { api, changeset, tools } = setup({ history: chatOf('m0', 'm1', 'm2', 'm3') });
    await tools.edit_message({ index: 3, value: 'M3' });
    stageMessageDelete(changeset, api, 1);

    await changeset.apply(api);
    expect(api.store.history.map((m) => m.mes)).toEqual(['m0', 'm2', 'M3']);

    expect((await changeset.undoLast(api)).ok).toBe(true);
    expect(api.store.history.map((m) => m.mes)).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  test('a message delete whose message changed after staging becomes a conflict with no write', async () => {
    const { api, changes, changeset } = setup({ history: chatOf('m0', 'm1') });
    stageMessageDelete(changeset, api, 1);
    api.store.history[1].mes = 'edited by the user';

    await changeset.apply(api);

    expect(changes[0].status).toBe('conflict');
    expect(api.chat.deleteMessage).not.toHaveBeenCalled();
    expect(api.store.history).toHaveLength(2);
  });

  test('a lorebook created with two entries applies book first, and undo removes all three', async () => {
    const { api, changeset } = setup({});
    changeset.stage({
      target: { kind: 'lorebook', book: 'Town', op: 'create' },
      label: 'Town',
      oldValue: '',
      newValue: '',
    });
    for (const uid of [1, 2]) {
      const created = entry(uid, { comment: `E${uid}`, content: `Entry ${uid}` });
      changeset.stage({
        target: { kind: 'entry', book: 'Town', uid, op: 'create' },
        label: `E${uid}`,
        oldValue: '',
        newValue: renderEntry(created),
        entryAfter: created,
      });
    }

    expect(await changeset.apply(api)).toHaveLength(3);
    expect(api.store.books).toHaveLength(1);
    expect(api.store.books[0].entries.map((e) => e.uid)).toEqual([1, 2]);

    expect((await changeset.undoLast(api)).ok).toBe(true);
    expect(api.store.books).toEqual([]);
  });

  test('a lorebook delete undoes by recreating the book with its entries', async () => {
    const original = { name: 'Eldoria', entries: [entry(1, { comment: 'Castle', content: 'A ruin.' })] };
    const { api, changeset } = setup({ books: [original] });
    changeset.stage({
      target: { kind: 'lorebook', book: 'Eldoria', op: 'delete' },
      label: 'Eldoria',
      oldValue: renderBook(original),
      newValue: '',
      bookBefore: structuredClone(original),
    });

    await changeset.apply(api);
    expect(api.store.books).toEqual([]);

    expect((await changeset.undoLast(api)).ok).toBe(true);
    expect(api.store.books).toEqual([original]);
  });

  test('a character create applies, records the avatar, and undo deletes it', async () => {
    const { api, changes, changeset } = setup({});
    const card = { name: 'Twin', description: 'A baker.', data: { alternate_greetings: ['Hi!', 'Hello!'] } };
    const id = changeset.stage({
      target: { kind: 'character', avatar: '', op: 'create' },
      label: 'Twin',
      oldValue: '',
      newValue: renderCard(card as Partial<Character>),
      card: card as Partial<Character>,
    });
    expect(changes[0].target).toMatchObject({ avatar: `new:${id}` });

    await changeset.apply(api);
    const avatar = (changes[0].target as { avatar: string }).avatar;
    expect(api.character.get(avatar)).toMatchObject({
      name: 'Twin',
      description: 'A baker.',
      data: { alternate_greetings: ['Hi!', 'Hello!'] },
    });

    expect((await changeset.undoLast(api)).ok).toBe(true);
    expect(api.store.characters).toEqual([]);
    expect(changes[0].target).toMatchObject({ avatar: `new:${id}` });
  });

  test('Accept all skips a character delete, which applies only by its id and leaves no undo', async () => {
    const { api, changes, changeset } = setup({ characters: [hazel] });
    const id = changeset.stage({
      target: { kind: 'character', avatar: 'hazel.png', op: 'delete' },
      label: 'Hazel',
      oldValue: renderCard(hazel as Partial<Character>),
      newValue: '',
    });

    expect(await changeset.apply(api)).toEqual([]);
    expect(changes[0].status).toBe('pending');

    await changeset.apply(api, [id]);
    expect(changes[0].status).toBe('applied');
    expect(api.store.characters).toEqual([]);
    expect(changeset.hasUndo()).toBe(false);
  });
});
