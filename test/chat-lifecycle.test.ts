import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationMode } from '../src/constants';
import {
  registerChatLifecycleHooks,
  runAfterGeneration,
  runAfterUserMessage,
  runBeforeGeneration,
} from '../src/services/chat-lifecycle';
import type { ChatMessage, ChatMetadata, PromptInjection } from '../src/types';

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

function message(user: boolean): ChatMessage {
  return {
    name: user ? 'User' : 'Assistant',
    mes: 'content',
    is_user: user,
    is_system: false,
    original_avatar: user ? 'persona' : 'character',
    send_date: '',
    swipes: ['content'],
    swipe_id: 0,
    swipe_info: [{ send_date: '', extra: {} }],
    extra: {},
  };
}

const metadata: ChatMetadata = { integrity: 'integrity' };

describe('single-owner chat lifecycle hooks', () => {
  it('registers one owner, awaits each exact hook, and unregisters identity-safely', async () => {
    const calls: string[] = [];
    const user = message(true);
    const assistant = message(false);
    const controller = new AbortController();
    const dispose = registerChatLifecycleHooks({
      afterUserMessage: async ({ messages }) => {
        expect(messages[0]).toBe(user);
        calls.push('after-user');
      },
      beforeGeneration: async ({ promptInjections }) => {
        calls.push('before-generation');
        promptInjections.push({
          id: 'injection',
          content: 'prompt',
          role: 'system',
          name: 'Agent',
          placement: 'relative',
          depth: 0,
        });
        return { assistantContent: 'supplied', includedPromptInjectionIds: ['injection'] };
      },
      afterGeneration: async ({ message: accepted, includedPromptInjectionIds }) => {
        expect(accepted).toBe(assistant);
        expect(includedPromptInjectionIds).toEqual(['injection']);
        calls.push('after-generation');
      },
    });
    disposers.push(dispose);
    expect(() => registerChatLifecycleHooks({})).toThrow('already registered');

    await runAfterUserMessage({
      chatFile: 'chat',
      messages: [user],
      metadata,
      message: user,
      messageIndex: 0,
      signal: controller.signal,
    });
    const injections: PromptInjection[] = [];
    const result = await runBeforeGeneration({
      chatFile: 'chat',
      messages: [user],
      metadata,
      generationId: 'generation',
      generationMode: GenerationMode.NEW,
      history: [user],
      target: { messageIndex: 1 },
      promptInjections: injections,
      signal: controller.signal,
    });
    expect(result).toEqual({ assistantContent: 'supplied', includedPromptInjectionIds: ['injection'] });
    expect(injections).toHaveLength(1);
    await runAfterGeneration({
      chatFile: 'chat',
      messages: [user, assistant],
      metadata,
      generationId: 'generation',
      generationMode: GenerationMode.NEW,
      history: [user, assistant],
      target: { message: assistant, messageIndex: 1, swipeId: 0 },
      message: assistant,
      includedPromptInjectionIds: ['injection'],
      signal: controller.signal,
    });
    expect(calls).toEqual(['after-user', 'before-generation', 'after-generation']);

    dispose();
    const replacement = registerChatLifecycleHooks({ beforeGeneration: vi.fn() });
    disposers.push(replacement);
  });

  it('propagates failures and cancellation without invoking later work', async () => {
    const after = vi.fn();
    disposers.push(
      registerChatLifecycleHooks({
        beforeGeneration: async () => {
          throw new Error('hook failed');
        },
        afterGeneration: after,
      }),
    );
    await expect(
      runBeforeGeneration({
        chatFile: 'chat',
        messages: [],
        metadata,
        generationId: 'generation',
        generationMode: GenerationMode.NEW,
        history: [],
        promptInjections: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('hook failed');
    expect(after).not.toHaveBeenCalled();

    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(
      runAfterUserMessage({
        chatFile: 'chat',
        messages: [],
        metadata,
        message: message(true),
        messageIndex: 0,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
