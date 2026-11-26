import { describe, expect, test } from 'vitest';
import { Changeset, type StagedChange } from '../changeset';
import { createAssistantTools } from '../tools';
import { entry, fakeDataApi, writeSpies } from '../test-support/fake-data-api';

function setup() {
  const api = fakeDataApi({
    characters: [{ avatar: 'hazel.png', name: 'Hazel', first_mes: 'Hello.', data: { alternate_greetings: [] } }],
    history: [{ name: 'Hazel', is_user: false, mes: 'Hello.' }],
    books: [{ name: 'Eldoria', entries: [entry(2, { comment: 'Castle' }), entry(9, { comment: 'Port' })] }],
    persona: { avatarId: 'alex.png', name: 'Alex', description: 'A traveler.', lorebooks: [], connections: [] },
  });
  const changes: StagedChange[] = [];
  const tools = Object.fromEntries(
    createAssistantTools(api, new Changeset(changes)).map((tool) => [tool.name, tool.action]),
  );
  return { api, changes, tools };
}

describe('assistant tools', () => {
  test('edit tools stage changes and never write app data', async () => {
    const { api, changes, tools } = setup();

    const results = [
      await tools.edit_character_field({ avatar: 'hazel.png', field: 'first_mes', value: 'Hi.' }),
      await tools.edit_character_field({ avatar: 'hazel.png', field: 'alternate_greetings.1', value: 'Yo.' }),
      await tools.edit_message({ index: 0, value: 'Hi.' }),
      await tools.upsert_entry({ book: 'Eldoria', uid: 2, content: 'A ruin.' }),
      await tools.upsert_entry({ book: 'Eldoria', comment: 'Town' }),
      await tools.delete_entry({ book: 'Eldoria', uid: 9 }),
      await tools.edit_persona_description({ value: 'A merchant.' }),
    ];

    expect(results.every((result) => typeof result.staged === 'string')).toBe(true);
    expect(changes).toHaveLength(7);
    for (const spy of writeSpies(api)) expect(spy).not.toHaveBeenCalled();
  });

  test('unknown ids and bad fields return an error and stage nothing', async () => {
    const { changes, tools } = setup();

    const results = [
      await tools.upsert_entry({ book: 'Eldoria', uid: 404, content: 'x' }),
      await tools.delete_entry({ book: 'Eldoria', uid: 404 }),
      await tools.upsert_entry({ book: 'Nowhere', content: 'x' }),
      await tools.edit_message({ index: 1, value: 'x' }),
      await tools.edit_character_field({ avatar: 'nobody.png', field: 'first_mes', value: 'x' }),
      await tools.edit_character_field({ avatar: 'hazel.png', field: 'name', value: 'x' }),
      await tools.edit_character_field({ avatar: 'hazel.png', field: 'alternate_greetings.2', value: 'x' }),
    ];

    expect(results.every((result) => typeof result.error === 'string')).toBe(true);
    expect(changes).toHaveLength(0);
  });

  test('upsert_entry without uid stages a create with uid = max + 1', async () => {
    const { changes, tools } = setup();

    const town = await tools.upsert_entry({ book: 'Eldoria', comment: 'Town', key: ['town'], content: 'Busy.' });
    const mill = await tools.upsert_entry({ book: 'Eldoria', comment: 'Mill' });

    // The model learns the new uid, so it can update or delete its own create.
    expect([town.uid, mill.uid]).toEqual([10, 11]);

    expect(changes.map((change) => change.target)).toEqual([
      { kind: 'entry', book: 'Eldoria', uid: 10, op: 'create' },
      { kind: 'entry', book: 'Eldoria', uid: 11, op: 'create' },
    ]);
    expect(changes[0].entryAfter).toMatchObject({
      uid: 10,
      comment: 'Town',
      key: ['town'],
      content: 'Busy.',
      order: 100,
    });
  });
});
