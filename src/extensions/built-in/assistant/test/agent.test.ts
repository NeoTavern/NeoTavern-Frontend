import { afterEach, describe, expect, test, vi } from 'vitest';
import { ToolService } from '../../../../services/tool.service';
import type { ApiChatMessage, GenerationResponse, LlmGenerationOptions } from '../../../../types';
import { runAgentTurn, type AgentAPI } from '../agent';
import { Changeset, type StagedChange } from '../changeset';
import type { AssistantConversation, ConversationMessage } from '../conversations';
import { entry, fakeDataApi } from '../test-support/fake-data-api';
import { createAssistantTools } from '../tools';
import type { AssistantRequestFormat } from '../types';

type Reply = Partial<GenerationResponse> | ((options: LlmGenerationOptions) => Partial<GenerationResponse>);

function setup(replies: Reply[]) {
  const data = fakeDataApi({
    history: [{ name: 'Hazel', is_user: false, mes: 'Hello.' }],
    books: [{ name: 'Eldoria', entries: [entry(2, { comment: 'Castle', content: 'Old.' })] }],
  });
  const changes: StagedChange[] = [];
  const tools = createAssistantTools(data, new Changeset(changes));
  const generate = vi.fn(async (_messages: ApiChatMessage[], options: LlmGenerationOptions = {}) => {
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected generate call');
    return { content: '', ...(typeof reply === 'function' ? reply(options) : reply) } as GenerationResponse;
  });
  const api = {
    llm: { generate },
    api: { getConnectionProfile: () => ({ id: 'p', name: 'P', provider: 'openai', model: 'gpt' }) },
    settings: { getGlobal: () => ({}) },
    tools: { getEnabled: () => [] },
  } as unknown as AgentAPI;
  const conversation: Pick<AssistantConversation, 'messages'> = {
    messages: [{ role: 'user', content: 'Fix the castle entry.', refs: [] }],
  };
  const run = (
    format: AssistantRequestFormat,
    extra: { signal?: AbortSignal; onMessage?: (m: ConversationMessage) => void } = {},
  ) => runAgentTurn(api, { conversation, tools, format, profile: 'p', ...extra });
  return { changes, conversation, generate, run };
}

const toolCall = (id: string, name: string, args: object) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) },
});

afterEach(() => vi.restoreAllMocks());

describe('agent loop, native tools', () => {
  test('tool-call rounds append tool_calls then matching tool messages, and stage a change', async () => {
    const supported = vi.spyOn(ToolService, 'isToolCallingSupported').mockReturnValue(true);
    const { changes, conversation, generate, run } = setup([
      { tool_calls: [toolCall('c1', 'get_lorebook', { book: 'Eldoria' })] },
      { tool_calls: [toolCall('c2', 'upsert_entry', { book: 'Eldoria', uid: 2, content: 'A ruin.' })] },
      { content: 'Proposed a new castle text.' },
    ]);

    expect(await run('tools')).toEqual({ status: 'done' });

    expect(supported).toHaveBeenCalledWith('openai', 'gpt', expect.anything(), true);
    expect(conversation.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0].entryAfter?.content).toBe('A ruin.');

    expect(generate).toHaveBeenCalledTimes(3);
    const [thirdMessages, thirdOptions] = generate.mock.calls[2];
    expect(thirdMessages.slice(2)).toMatchObject([
      { role: 'assistant', tool_calls: [{ id: 'c1' }] },
      { role: 'tool', tool_call_id: 'c1' },
      { role: 'assistant', tool_calls: [{ id: 'c2' }] },
      { role: 'tool', tool_call_id: 'c2', content: expect.stringContaining('"staged"') },
    ]);
    expect(thirdOptions?.toolConfig).toMatchObject({ includeRegisteredTools: true, bypassGlobalCheck: true });
    expect(thirdOptions?.toolConfig?.additionalTools?.map((tool) => tool.name)).toContain('upsert_entry');
  });

  test('an unsupported profile never calls generate', async () => {
    vi.spyOn(ToolService, 'isToolCallingSupported').mockReturnValue(false);
    const { conversation, generate, run } = setup([]);

    expect(await run('tools')).toEqual({ status: 'unsupported' });
    expect(generate).not.toHaveBeenCalled();
    expect(conversation.messages).toHaveLength(1);
  });

  test('aborting while tool results come in stops with no further generate call', async () => {
    vi.spyOn(ToolService, 'isToolCallingSupported').mockReturnValue(true);
    const controller = new AbortController();
    const { conversation, generate, run } = setup([
      { tool_calls: [toolCall('c1', 'get_messages', { from: 0, to: 0 }), toolCall('c2', 'get_persona', {})] },
      { content: 'never sent' },
    ]);

    const result = await run('tools', {
      signal: controller.signal,
      onMessage: (message) => message.role === 'tool' && controller.abort(),
    });

    expect(result).toEqual({ status: 'aborted' });
    expect(generate).toHaveBeenCalledTimes(1);
    // Every call of the round still has its result, so the conversation can continue.
    expect(conversation.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
  });
});

describe('agent loop, structured json', () => {
  const structured = (reply: string, calls: { name: string; args: object }[]) => ({
    structured_content: {
      reply,
      calls: calls.map((call) => ({ name: call.name, arguments: JSON.stringify(call.args) })),
    },
  });

  test('calls run, results go back as one user message, and calls: [] ends the turn with the reply', async () => {
    const supported = vi.spyOn(ToolService, 'isToolCallingSupported');
    const { changes, conversation, generate, run } = setup([
      structured('', [
        { name: 'get_lorebook', args: { book: 'Eldoria' } },
        { name: 'edit_message', args: { index: 0, value: 'Hi.' } },
      ]),
      structured('Proposed a shorter greeting.', []),
    ]);

    expect(await run('json')).toEqual({ status: 'done' });

    expect(supported).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(2);
    const [firstMessages, firstOptions] = generate.mock.calls[0];
    expect(firstOptions?.toolConfig).toBeUndefined();
    expect(firstOptions?.structuredResponse?.format).toBe('json');
    // llm.generate doesn't add the prompted-format instructions; the system prompt carries them and the tool list.
    expect(firstMessages[0].content).toContain('edit_message');
    expect(firstMessages[0].content).toContain('JSON SCHEMA TO FOLLOW');

    const secondMessages = generate.mock.calls[1][0];
    const resultMessages = secondMessages.filter(
      (message) => message.role === 'user' && String(message.content).startsWith('Tool results:'),
    );
    expect(resultMessages).toHaveLength(1);
    expect(secondMessages.at(-1)).toBe(resultMessages[0]);
    expect(secondMessages.some((message) => message.role === 'tool')).toBe(false);

    expect(changes.map((change) => change.target)).toEqual([{ kind: 'message', index: 0 }]);
    expect(conversation.messages.at(-1)).toEqual({
      role: 'assistant',
      content: 'Proposed a shorter greeting.',
      toolCalls: [],
    });
  });

  test('a parse error stops the turn with the raw output and no further generate call', async () => {
    const { conversation, generate, run } = setup([{ content: 'not json at all' }, structured('late', [])]);

    const result = await run('json');

    expect(result).toMatchObject({ status: 'parse-error', rawContent: 'not json at all' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(conversation.messages).toHaveLength(1);
  });
});
