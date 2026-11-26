import { describe, expect, test, vi } from 'vitest';
import type { ChatMessage } from '../../../../types';
import { Changeset, type StagedChange } from '../changeset';
import { createAssistantTools } from '../tools';
import { entry, fakeDataApi, writeSpies } from '../test-support/fake-data-api';

// The real one reads the persona store for a cache-busting timestamp.
vi.mock('../../../../utils/character', () => ({
  getThumbnailUrl: (type: string, file: string) => `/thumbnail?type=${type}&file=${file}`,
}));

function setup(options: Parameters<typeof fakeDataApi>[0] = {}) {
  const api = fakeDataApi({
    characters: [{ avatar: 'hazel.png', name: 'Hazel', first_mes: 'Hello.', data: { alternate_greetings: [] } }],
    history: [{ name: 'Hazel', is_user: false, mes: 'Hello.' }],
    books: [{ name: 'Eldoria', entries: [entry(2, { comment: 'Castle' }), entry(9, { comment: 'Port' })] }],
    persona: { avatarId: 'alex.png', name: 'Alex', description: 'A traveler.', lorebooks: [], connections: [] },
    ...options,
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
      await tools.insert_message({ index: 1, role: 'user', value: 'Hey.' }),
      await tools.delete_message({ index: 0 }),
      await tools.create_lorebook({ name: 'Town' }),
      await tools.create_character({ name: 'Twin' }),
      await tools.delete_character({ avatar: 'hazel.png' }),
    ];

    expect(results.every((result) => typeof result.staged === 'string')).toBe(true);
    // delete_message drops the pending edit of the same message.
    expect(changes).toHaveLength(11);
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

  test('a character staged by create_character can be read and edited by its new: avatar', async () => {
    const { changes, tools } = setup();

    const created = await tools.create_character({ name: 'Twin', description: 'A baker.' });
    expect(created.avatar).toBe(`new:${created.staged}`);

    const edits = [
      await tools.edit_character_field({ avatar: created.avatar, field: 'personality', value: 'Cheerful.' }),
      await tools.edit_character_field({ avatar: created.avatar, field: 'alternate_greetings.1', value: 'Morning!' }),
      await tools.edit_character_field({ avatar: created.avatar, field: 'alternate_greetings.2', value: 'Bread?' }),
    ];

    // Every edit lands on the one staged create.
    expect(edits.map((edit) => edit.staged)).toEqual([created.staged, created.staged, created.staged]);
    expect(changes).toHaveLength(1);
    expect(await tools.get_character({ avatar: created.avatar })).toMatchObject({
      avatar: created.avatar,
      name: 'Twin',
      description: 'A baker.',
      personality: 'Cheerful.',
      alternate_greetings: ['Morning!', 'Bread?'],
    });
    expect(changes[0].newValue).toContain('alternate_greetings.2:\nBread?');
  });

  test('upsert_entry into a book staged by create_lorebook stages an entry create', async () => {
    const { changes, tools } = setup();

    await tools.create_lorebook({ name: 'Town' });
    const bakery = await tools.upsert_entry({ book: 'Town', comment: 'Bakery', content: 'Warm.' });

    expect(bakery).toMatchObject({ uid: 0 });
    expect(changes.map((change) => change.target)).toEqual([
      { kind: 'lorebook', book: 'Town', op: 'create' },
      { kind: 'entry', book: 'Town', uid: 0, op: 'create' },
    ]);
    expect(await tools.list_lorebooks({})).toEqual(['Eldoria', 'Town']);
  });

  test('targets staged for deletion are refused', async () => {
    const { changes, tools } = setup();

    await tools.delete_lorebook({ book: 'Eldoria' });
    await tools.delete_message({ index: 0 });
    await tools.delete_character({ avatar: 'hazel.png' });

    const results = [
      await tools.get_lorebook({ book: 'Eldoria' }),
      await tools.upsert_entry({ book: 'Eldoria', comment: 'Town' }),
      await tools.delete_entry({ book: 'Eldoria', uid: 2 }),
      await tools.edit_message({ index: 0, value: 'x' }),
      await tools.edit_character_field({ avatar: 'hazel.png', field: 'first_mes', value: 'x' }),
    ];

    expect(results.every((result) => typeof (result as { error?: string }).error === 'string')).toBe(true);
    expect(changes).toHaveLength(3);
  });

  test('delete_message refuses a message that ends a merged tool chain', async () => {
    const history = [
      { name: 'Alex', is_user: true, is_system: false, mes: 'Look it up.', extra: {} },
      { name: 'Hazel', is_user: false, is_system: false, mes: '', extra: { tool_invocations: [{}] } },
      { name: 'Tool', is_user: false, is_system: true, mes: 'Result.', extra: {} },
      { name: 'Hazel', is_user: false, is_system: false, mes: 'Found it.', extra: {} },
    ] as Partial<ChatMessage>[];

    const merged = setup({ history, mergeToolMessages: true });
    expect(await merged.tools.delete_message({ index: 3 })).toHaveProperty('error');
    // A character message right after the tool call would be deleted with the chain on undo.
    expect(await merged.tools.insert_message({ index: 2, role: 'character', value: 'Hm.' })).toHaveProperty('error');
    expect(await merged.tools.delete_message({ index: 0 })).toHaveProperty('staged');
    expect(merged.changes).toHaveLength(1);

    // Without merging, deleteMessage removes one message, so any index is fine.
    const plain = setup({ history, mergeToolMessages: false });
    expect(await plain.tools.delete_message({ index: 3 })).toHaveProperty('staged');
  });

  test('create_lorebook refuses an existing or already staged name', async () => {
    const { changes, tools } = setup();

    expect(await tools.create_lorebook({ name: 'Eldoria' })).toHaveProperty('error');
    await tools.create_lorebook({ name: 'Town' });
    expect(await tools.create_lorebook({ name: 'Town' })).toHaveProperty('error');
    expect(changes).toHaveLength(1);
  });

  test('insert_message builds a message for the given speaker at a checked index', async () => {
    const { changes, tools } = setup();

    expect(await tools.insert_message({ index: 2, role: 'user', value: 'x' })).toHaveProperty('error');
    await tools.insert_message({ index: 0, role: 'character', value: 'Earlier.' });

    expect(changes[0].target).toEqual({ kind: 'message-insert', index: 0 });
    expect(changes[0].message).toMatchObject({
      name: 'Hazel',
      is_user: false,
      is_system: false,
      original_avatar: 'hazel.png',
      mes: 'Earlier.',
      swipes: ['Earlier.'],
      swipe_id: 0,
    });
    expect(
      await setup({ chatOpen: false }).tools.insert_message({ index: 0, role: 'user', value: 'x' }),
    ).toHaveProperty('error');
  });
});
