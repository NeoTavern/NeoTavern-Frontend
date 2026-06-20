import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatCompletionService, processMessagesWithPrefill } from '../src/api/generation';
import { CustomPromptPostProcessing } from '../src/constants';
import { useAuthStore } from '../src/stores/auth.store';
import type { ApiChatMessage, ChatCompletionPayload } from '../src/types/generation';

describe('processMessagesWithPrefill', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    setActivePinia(createPinia());
    useAuthStore().token = 'test-token';
  });

  it('preserves a named assistant prefill after single-message post-processing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ role: 'user', content: 'merged prompt', name: 'User' }] }), {
        status: 200,
      }),
    );

    const messages: ApiChatMessage[] = [
      { role: 'system', content: 'System prompt', name: 'System' },
      { role: 'user', content: 'Hello', name: 'User' },
      { role: 'assistant', content: 'Eli: ', name: 'Eli' },
    ];

    const result = await processMessagesWithPrefill(messages, CustomPromptPostProcessing.SINGLE);

    expect(result).toEqual([
      { role: 'user', content: 'merged prompt', name: 'User' },
      { role: 'assistant', content: 'Eli: ', name: 'Eli' },
    ]);

    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(request.messages).toEqual(messages.slice(0, -1));
  });

  it('preserves impersonate starter text as assistant prefill', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ role: 'user', content: 'merged prompt', name: 'User' }] }), {
        status: 200,
      }),
    );

    const result = await processMessagesWithPrefill(
      [
        { role: 'user', content: 'Hello', name: 'User' },
        { role: 'assistant', content: 'Eli: I think', name: 'Eli' },
      ],
      CustomPromptPostProcessing.SINGLE,
    );

    expect(result.at(-1)).toEqual({ role: 'assistant', content: 'Eli: I think', name: 'Eli' });
  });

  it('preserves leading whitespace in the first streamed prefill chunk', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        [
          'data: {"choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
          'data: {"choices":[{"delta":{"content":" \\""},"finish_reason":null}]}',
          'data: {"choices":[{"delta":{"content":"Local"},"finish_reason":null}]}',
          'data: [DONE]',
          '',
        ].join('\n\n'),
        { status: 200 },
      ),
    );

    const response = await ChatCompletionService.generate(
      {
        model: 'deepseek-v4-flash',
        chat_completion_source: 'deepseek',
        stream: true,
        messages: [{ role: 'assistant', content: 'Joe: The name of the book is', name: 'Joe' }],
      } as ChatCompletionPayload,
      'chat',
      { isContinuation: true },
    );

    let generated = '';
    if (Symbol.asyncIterator in response) {
      for await (const chunk of response) {
        generated += chunk.delta ?? '';
      }
    }

    expect(generated).toBe(' "Local');
  });
});
