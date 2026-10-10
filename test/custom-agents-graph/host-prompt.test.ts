import { describe, expect, it, vi } from 'vitest';
import { macroService } from '../../src/services/macro-service';
import type { ChatMessage } from '../../src/types';
import {
  GraphHostLlmDispatcher,
  GraphHostTemplateRenderer,
} from '../../src/extensions/built-in/custom-agents/host/prompt';
import type { GraphLlmRequest } from '../../src/extensions/built-in/custom-agents/registry/node-definition';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';
import { genericToolCatalog } from '../../src/extensions/built-in/custom-agents/registry/tools';
import type { CustomAgentsHostAPI } from '../../src/extensions/built-in/custom-agents/host/api';

function message(content: string, user: boolean): ChatMessage {
  return {
    name: user ? 'User' : 'Assistant',
    mes: content,
    is_user: user,
    is_system: false,
    original_avatar: '',
    send_date: '',
    swipes: [content],
    swipe_id: 0,
    swipe_info: [{ send_date: '', extra: {} }],
    extra: {},
  };
}

function request(overrides: Partial<GraphLlmRequest> = {}): GraphLlmRequest {
  return {
    requestId: 'request-1',
    source: 'core.custom-agents',
    nodeId: 'llm',
    flowId: 'flow',
    prompt: '{{input.topic}}/{{state.value}}/{{lastMessage}}',
    variables: { topic: 'scene' },
    assembly: {
      type: 'NORMAL_CHAT',
      history: 'FULL_TARGET',
      placement: { type: 'AFTER_CONTEXT', role: 'USER' },
    },
    connectionProfileId: null,
    structuredFormat: 'NATIVE',
    outputSchema: { type: 'object', additionalProperties: false },
    event: {
      trigger: 'BEFORE_ASSISTANT_GENERATION',
      generationId: 'outer',
      generationMode: 'REGENERATE',
      targetMessage: { index: 1, role: 'ASSISTANT', name: 'Assistant', content: 'selected swipe' },
    },
    configuration: {},
    state: { value: 4 },
    promptContext: {
      chatHistory: [message('first', true), message('stale swipe', false), message('excluded sibling', true)],
      targetMessage: { index: 1, role: 'ASSISTANT', name: 'Assistant', content: 'selected swipe' },
      currentCharacter: { name: 'Assistant' },
      persona: { name: 'User' },
    },
    signal: new AbortController().signal,
    ...overrides,
  };
}

function api() {
  const buildPrompt = vi.fn(async () => ({
    messages: [{ role: 'system' as const, name: 'World', content: 'world' }],
    includedPromptInjectionIds: [] as string[],
  }));
  const generate = vi.fn(async (_messages, options) => {
    options?.onCompletion?.({ outputTokens: 1, duration: 1, structured_content: {} });
    return { content: '' };
  });
  return {
    host: {
      macro: {
        process: (text, context, additionalMacros) => macroService.process(text, { ...context, additionalMacros }),
      },
      chat: { buildPrompt },
      llm: { generate },
    } as unknown as CustomAgentsHostAPI,
    buildPrompt,
    generate,
  };
}

describe('graph prompt host capabilities', () => {
  it('uses cache-preserving buildPrompt assembly with exact target history, macros, and request identity', async () => {
    const mock = api();
    const dispatcher = new GraphHostLlmDispatcher(mock.host);
    await expect(dispatcher.dispatch(request())).resolves.toEqual({});

    expect(mock.buildPrompt).toHaveBeenCalledOnce();
    const built = mock.buildPrompt.mock.calls[0]![0];
    expect(built.generationId).toBe('request-1');
    expect(built.chatHistory.map((item: ChatMessage) => item.mes)).toEqual(['first', 'selected swipe']);
    expect(mock.generate).toHaveBeenCalledOnce();
    expect(mock.generate.mock.calls[0]![0]).toEqual([
      { role: 'system', name: 'World', content: 'world' },
      { role: 'user', name: 'Custom Agent', content: 'scene/4/selected swipe' },
    ]);
    expect(mock.generate.mock.calls[0]![1]).toMatchObject({ generationId: 'request-1', captureMessageIndex: 1 });
  });

  it('uses the normal generation history prefix without the generated target', async () => {
    const mock = api();
    const dispatcher = new GraphHostLlmDispatcher(mock.host);
    await expect(
      dispatcher.dispatch(
        request({
          assembly: {
            type: 'NORMAL_CHAT',
            history: 'FULL_BEFORE_TARGET',
            placement: { type: 'AFTER_CONTEXT', role: 'SYSTEM' },
          },
        }),
      ),
    ).resolves.toEqual({});

    const built = mock.buildPrompt.mock.calls[0]![0];
    expect(built.chatHistory.map((item: ChatMessage) => item.mes)).toEqual(['first']);
    expect(mock.generate.mock.calls[0]![0]).toEqual([
      { role: 'system', name: 'World', content: 'world' },
      { role: 'system', name: 'Custom Agent', content: 'scene/4/first' },
    ]);
  });

  it('bounds RECENT_TARGET after adding the selected target and retains its original event index', async () => {
    const runtime = builtinNodeRegistry.get('llm.request')?.runtime;
    if (!runtime || runtime.kind !== 'EXECUTOR') throw new Error('llm.request executor is unavailable');
    const dispatch = vi.fn(async () => ({}));
    await runtime.execute({
      nodeId: 'llm',
      flowId: 'generator',
      data: {
        prompt: '',
        variables: [],
        assembly: {
          type: 'NORMAL_CHAT',
          history: 'RECENT_TARGET',
          placement: { type: 'AFTER_CONTEXT', role: 'SYSTEM' },
        },
        outputSchema: {},
      },
      inputs: { historyCount: 1, structuredFormat: 'NATIVE' },
      event: {
        trigger: 'ASSISTANT_GENERATION',
        generationId: 'generation',
        generationMode: 'REGENERATE',
        targetMessage: { index: 2, role: 'ASSISTANT', name: 'Assistant', content: 'selected swipe' },
      },
      configuration: {},
      state: {},
      signal: new AbortController().signal,
      random: { next: () => 0.5 },
      ids: { generate: () => 'recent-request' },
      tools: genericToolCatalog,
      llm: { dispatch },
      templates: { render: async ({ template }) => template },
      promptContext: {
        chatHistory: [message('ancestor', false), message('parent', true)],
        targetMessage: { index: 2, role: 'ASSISTANT', name: 'Assistant', content: 'selected swipe' },
        currentCharacter: null,
        persona: null,
      },
    });

    const bounded = dispatch.mock.calls[0]![0];
    expect(bounded.promptContext.chatHistory.map((item: ChatMessage) => item.mes)).toEqual(['selected swipe']);
    expect(bounded.promptContext.targetMessage?.index).toBe(0);
    expect('targetMessage' in bounded.event && bounded.event.targetMessage?.index).toBe(2);
  });

  it('fails an excluded IN_CHAT task before invoking the LLM and acknowledges only host inclusions', async () => {
    const mock = api();
    const acknowledge = vi.fn();
    const dispatcher = new GraphHostLlmDispatcher(mock.host, () => ({
      injections: [
        { id: 'outer-injection', content: 'remember', role: 'system', name: 'Agent', placement: 'relative', depth: 0 },
      ],
      acknowledge,
    }));
    const inChat = request({
      assembly: {
        type: 'NORMAL_CHAT',
        history: 'FULL_CURRENT',
        placement: { type: 'IN_CHAT', role: 'SYSTEM', depth: 2 },
      },
    });

    await expect(dispatcher.dispatch(inChat)).rejects.toThrow('IN_CHAT task prompt was excluded by prompt budgeting');
    expect(mock.generate).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith([]);
    const injections = mock.buildPrompt.mock.calls[0]![0].promptInjections;
    expect(injections[0].id).toBe('outer-injection');
    expect(injections[1]).toMatchObject({ role: 'system', placement: 'in-chat', depth: 2 });
  });

  it('renders declared input macros and rejects executable macros before template expansion', async () => {
    const mock = api();
    const renderer = new GraphHostTemplateRenderer(mock.host);
    const base = {
      variables: { name: 'Ada' },
      event: { trigger: 'MANUAL' as const, input: {} },
      configuration: {},
      state: {},
      promptContext: { chatHistory: [], currentCharacter: null, persona: null },
      signal: new AbortController().signal,
    };
    await expect(renderer.render({ ...base, template: 'Hello {{input.name}}' })).resolves.toBe('Hello Ada');
    await expect(renderer.render({ ...base, template: '{{setvar::unsafe::1}}' })).rejects.toThrow(
      "Custom Agent prompt macro 'setvar' is forbidden",
    );
  });
});
