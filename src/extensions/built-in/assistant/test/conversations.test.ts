import { describe, expect, test } from 'vitest';
import { Changeset } from '../changeset';
import { ConversationStore, createConversation, toApiMessages, type AssistantConversation } from '../conversations';
import { entry, fakeDataApi } from '../test-support/fake-data-api';

/** An in-memory stand-in for the localforage instance, storing what IndexedDB would: a copy. */
function memoryStorage() {
  const items = new Map<string, unknown>();
  return {
    getItem: async <T>(key: string) => (items.has(key) ? (structuredClone(items.get(key)) as T) : null),
    setItem: async <T>(key: string, value: T) => {
      items.set(key, structuredClone(value));
      return value;
    },
    removeItem: async (key: string) => {
      items.delete(key);
    },
    iterate: async <T, U>(callback: (value: T, key: string, index: number) => U) => {
      let index = 0;
      for (const [key, value] of items) callback(structuredClone(value) as T, key, ++index);
      return undefined as U;
    },
  };
}

function conversationWithToolRound(): AssistantConversation {
  const conversation = createConversation();
  conversation.messages.push(
    {
      role: 'user',
      content: '[Referenced]\n...\n\nFix it.',
      refs: [{ kind: 'lorebook', book: 'Eldoria', label: 'Eldoria' }],
    },
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'c1', name: 'get_messages', arguments: '{"from":0,"to":0}' },
        { id: 'c2', name: 'get_persona', arguments: '{}' },
      ],
    },
    { role: 'tool', toolCallId: 'c1', name: 'get_messages', content: '[]' },
    { role: 'tool', toolCallId: 'c2', name: 'get_persona', content: '{"name":"Alex"}' },
    { role: 'assistant', content: 'Done.', toolCalls: [] },
  );
  return conversation;
}

describe('conversations', () => {
  test('a saved conversation maps to tool messages, or to one "Tool results" message per round', async () => {
    const store = new ConversationStore(memoryStorage());
    const original = conversationWithToolRound();
    await store.save(original);
    const loaded = (await store.get(original.id))!;
    expect(loaded).toEqual(original);

    expect(toApiMessages(loaded.messages, 'tools')).toEqual([
      { role: 'user', name: 'User', content: '[Referenced]\n...\n\nFix it.' },
      {
        role: 'assistant',
        name: 'Assistant',
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'get_messages', arguments: '{"from":0,"to":0}' } },
          { id: 'c2', type: 'function', function: { name: 'get_persona', arguments: '{}' } },
        ],
      },
      { role: 'tool', name: 'get_messages', tool_call_id: 'c1', content: '[]' },
      { role: 'tool', name: 'get_persona', tool_call_id: 'c2', content: '{"name":"Alex"}' },
      { role: 'assistant', name: 'Assistant', content: 'Done.' },
    ]);

    const json = toApiMessages(loaded.messages, 'json');
    expect(json.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(JSON.parse(json[1].content as string)).toEqual({
      reply: '',
      calls: [
        { name: 'get_messages', arguments: '{"from":0,"to":0}' },
        { name: 'get_persona', arguments: '{}' },
      ],
    });
    expect(json[2].content).toBe('Tool results:\n\n[get_messages]\n[]\n\n[get_persona]\n{"name":"Alex"}');
    expect(JSON.parse(json[3].content as string)).toEqual({ reply: 'Done.', calls: [] });
  });

  test('undo after a reload reverts the last apply batch', async () => {
    const api = fakeDataApi({
      history: [{ name: 'Hazel', is_user: false, mes: 'Hello.' }],
      books: [{ name: 'Eldoria', entries: [entry(2, { comment: 'Castle', content: 'Old.' })] }],
    });
    const store = new ConversationStore(memoryStorage());
    const conversation = createConversation();
    const changeset = new Changeset(conversation.changes);
    changeset.stage({ target: { kind: 'message', index: 0 }, label: 'm', oldValue: 'Hello.', newValue: 'Hi.' });
    await changeset.apply(api);
    changeset.stage({ target: { kind: 'message', index: 0 }, label: 'm', oldValue: 'Hi.', newValue: 'Hey.' });
    await changeset.apply(api);
    await store.save(conversation);

    const reloaded = new Changeset((await store.get(conversation.id))!.changes);
    expect(await reloaded.undoLast(api)).toMatchObject({ ok: true });

    expect(api.store.history[0].mes).toBe('Hi.');
    expect(reloaded.changes.map((change) => change.status)).toEqual(['applied', 'pending']);
  });
});
