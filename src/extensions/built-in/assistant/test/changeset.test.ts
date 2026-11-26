import { describe, expect, test } from 'vitest';
import { Changeset, type StagedChange } from '../changeset';
import { createAssistantTools } from '../tools';
import { entry, fakeDataApi } from '../test-support/fake-data-api';

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
