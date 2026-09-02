import { createPinia, setActivePinia } from 'pinia';
import { isReactive, reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatCompletionService } from '../src/api/generation';
import { GenerationMode } from '../src/constants';
import type { GraphPreset, JsonObject } from '../src/extensions/built-in/custom-agents/graph/contracts';
import type { CustomAgentsHostAPI } from '../src/extensions/built-in/custom-agents/host/api';
import { CUSTOM_AGENTS_CHECKPOINT_KEY } from '../src/extensions/built-in/custom-agents/host/checkpoints';
import {
  registerGraphCustomAgentsGeneration,
  runGraphManualFlow,
} from '../src/extensions/built-in/custom-agents/host/generation';
import {
  compileGraphAgents,
  type GraphCustomAgentsRuntime,
} from '../src/extensions/built-in/custom-agents/host/runtime';
import { createDefaultSettings } from '../src/services/settings-migration.service';
import { chatService } from '../src/services/chat.service';
import { useCharacterStore } from '../src/stores/character.store';
import { useChatStore } from '../src/stores/chat.store';
import { usePersonaStore } from '../src/stores/persona.store';
import { useSettingsStore } from '../src/stores/settings.store';
import type { Character, ChatMessage, Persona } from '../src/types';
import { eventEmitter, extensionAPI } from '../src/utils/extensions';

vi.mock('../src/composables/useStrictI18n', () => ({
  useStrictI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../src/api/tokenizer', () => ({
  ApiTokenizer: class {
    async getTokenCount(content: string): Promise<number> {
      return content.length;
    }
  },
}));

const modes = ['NEW', 'REGENERATE', 'ADD_SWIPE'];
const cleanup: Array<() => void> = [];
const character: Character = {
  name: 'Character',
  avatar: 'character.png',
  description: '',
  personality: '',
  scenario: '',
  mes_example: '',
  data: {},
};
const persona: Persona = {
  name: 'User',
  avatarId: 'persona.png',
  description: '',
  lorebooks: [],
  connections: [],
};

function triggerFlow(
  id: string,
  type: string,
  schedule: { type: 'ALWAYS' } | { type: 'EVERY_N_EVENTS'; interval: number } = { type: 'ALWAYS' },
) {
  return {
    id,
    name: id,
    kind: 'TRIGGER' as const,
    inputs: [],
    outputs: [],
    nodes: [
      {
        id: `${id}-trigger`,
        type,
        position: { x: 0, y: 0 },
        data:
          type === 'trigger.manual'
            ? { inputSchema: { type: 'object', additionalProperties: true } }
            : type === 'trigger.after-user'
              ? { schedule }
              : { generationModes: modes, schedule },
        inputValues: {},
      },
      {
        id: `${id}-effect`,
        type: type === 'trigger.generate-assistant' ? 'effect.generation-response' : 'effect.set-state',
        position: { x: 1, y: 0 },
        data: type === 'trigger.generate-assistant' ? {} : { path: 'value' },
        inputValues: type === 'trigger.generate-assistant' ? { content: 'graph response' } : { value: 1 },
      },
    ],
    edges: [
      {
        id: `${id}-edge`,
        kind: 'CONTROL' as const,
        source: { nodeId: `${id}-trigger`, portId: 'out' },
        target: { nodeId: `${id}-effect`, portId: 'in' },
      },
    ],
  };
}

function preset(flows: GraphPreset['agent']['flows']): GraphPreset {
  return {
    format: 'NEOTAVERN_CUSTOM_AGENT_FLOW',
    agent: {
      id: 'agent',
      name: 'Agent',
      enabled: true,
      priority: 1,
      configurationSchema: { type: 'object', properties: {}, additionalProperties: false },
      configurationDefaults: {},
      stateSchema: {
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
        additionalProperties: false,
      },
      initialState: { value: 0 },
      flows,
      views: [],
    },
  };
}

function assistant(content = 'old'): ChatMessage {
  return {
    name: character.name,
    mes: content,
    is_user: false,
    is_system: false,
    original_avatar: character.avatar,
    send_date: '',
    swipes: [content],
    swipe_id: 0,
    swipe_info: [{ send_date: '', extra: {} }],
    extra: {},
  };
}

function user(content = 'hello'): ChatMessage {
  return {
    name: persona.name,
    mes: content,
    is_user: true,
    is_system: false,
    original_avatar: persona.avatarId,
    send_date: '',
    swipes: [content],
    swipe_id: 0,
    swipe_info: [{ send_date: '', extra: {} }],
    extra: {},
  };
}

function setChat(messages: ChatMessage[]) {
  const store = useChatStore();
  store.activeChat = { metadata: { integrity: 'chat' }, messages, fileName: 'chat' };
  store.activeChatFile = 'chat';
  return store;
}

type TestRuntime = GraphCustomAgentsRuntime & {
  currentGenerationInjections():
    | { injections: readonly { id: string; content: string }[]; acknowledge(ids: readonly string[]): void }
    | undefined;
};

function runtimeFor(flows: GraphPreset['agent']['flows'], execute: GraphCustomAgentsRuntime['execute']): TestRuntime {
  const agents = compileGraphAgents([preset(flows)]);
  let generationInjections:
    | { injections: readonly { id: string; content: string }[]; acknowledge(ids: readonly string[]): void }
    | undefined;
  return {
    getAgents: () => agents,
    execute,
    setGenerationInjections: (_generationId, value) => {
      generationInjections = value;
    },
    currentGenerationInjections: () => generationInjections,
  } as unknown as TestRuntime;
}

function completed(flowId: string, state: JsonObject, response?: string) {
  return {
    status: 'COMPLETED' as const,
    flowId,
    state,
    effects: [],
    ...(response === undefined ? {} : { generationResponse: response }),
    diagnostics: [],
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  const settings = useSettingsStore();
  settings.settings = createDefaultSettings();
  settings.settings.api.selectedProviderModels.openai = 'gpt-4o-mini';
  const characters = useCharacterStore();
  characters.characters = [character];
  characters.setActiveCharacterAvatars([character.avatar]);
  const personas = usePersonaStore();
  personas.personas = [persona];
  personas.activePersonaId = persona.avatarId;
});

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('registered Custom Agent lifecycle integration', () => {
  it('runs after-user, before observer, generator, and after-generation before the final live save', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const flows = [
      triggerFlow('after-user', 'trigger.after-user'),
      triggerFlow('before', 'trigger.before-generation'),
      triggerFlow('generator', 'trigger.generate-assistant'),
      triggerFlow('after', 'trigger.after-generation'),
    ];
    const runtime = runtimeFor(flows, async (request) => {
      order.push(request.flow.id);
      const state = { value: (request.state.value as number) + 1 };
      await request.onEffectsApplied?.(state, []);
      return completed(request.flow.id, state, request.flow.id === 'generator' ? 'graph response' : undefined);
    });
    const provider = vi.spyOn(ChatCompletionService, 'generate');
    const storageSave = vi.spyOn(chatService, 'save').mockImplementation(async () => {
      order.push('save');
    });
    const store = setChat([]);
    cleanup.push(
      eventEmitter.on('message:created', (message) =>
        order.push(message.is_user ? 'user-created' : 'assistant-created'),
      ),
      eventEmitter.on('generation:finished', () => order.push('finished')),
      registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime),
    );

    await store.sendMessage('hello', { generationId: 'full-lifecycle' });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(provider).not.toHaveBeenCalled();
    expect(storageSave).toHaveBeenCalledOnce();
    expect(store.activeChat?.messages.map(({ mes }) => mes)).toEqual(['hello', 'graph response']);
    expect(order).toEqual([
      'after-user',
      'user-created',
      'before',
      'generator',
      'assistant-created',
      'after',
      'finished',
      'save',
    ]);
  });

  it.each([GenerationMode.NEW, GenerationMode.REGENERATE, GenerationMode.ADD_SWIPE])(
    'uses the normal live %s finalization path for a graph response',
    async (mode) => {
      const runtime = runtimeFor([triggerFlow('generator', 'trigger.generate-assistant')], async (request) =>
        completed(request.flow.id, request.state, 'graph response'),
      );
      const store = setChat(mode === GenerationMode.NEW ? [user()] : [user(), assistant()]);
      const provider = vi.spyOn(ChatCompletionService, 'generate');
      cleanup.push(registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime));

      await store.generateResponse(mode, { generationId: `graph-${mode}` });

      expect(provider).not.toHaveBeenCalled();
      expect(store.activeChat?.messages.at(-1)?.mes).toBe('graph response');
      if (mode === GenerationMode.ADD_SWIPE)
        expect(store.activeChat?.messages.at(-1)?.swipes).toEqual(['old', 'graph response']);
    },
  );

  it.each(
    [false, true].flatMap((stream) =>
      [GenerationMode.NEW, GenerationMode.REGENERATE, GenerationMode.ADD_SWIPE].map((mode) => ({ stream, mode })),
    ),
  )('runs registered observers through normal $mode generation (stream=$stream)', async ({ stream, mode }) => {
    useSettingsStore().settings.api.samplers.stream = stream;
    const order: string[] = [];
    const runtime = runtimeFor(
      [triggerFlow('before', 'trigger.before-generation'), triggerFlow('after', 'trigger.after-generation')],
      async (request) => {
        order.push(request.flow.id);
        return completed(request.flow.id, request.state);
      },
    );
    const store = setChat(mode === GenerationMode.NEW ? [user()] : [user(), assistant()]);
    const streamResponse = async function* () {
      yield { delta: 'normal ' };
      yield { delta: 'response' };
    };
    vi.spyOn(ChatCompletionService, 'generate').mockImplementation(async () =>
      stream ? streamResponse() : { content: 'normal response' },
    );
    cleanup.push(
      eventEmitter.on('message:created', (message) => {
        if (!message.is_user) order.push('message');
      }),
      eventEmitter.on('message:updated', () => order.push('message')),
      eventEmitter.on('generation:finished', () => order.push('finished')),
      registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime),
    );

    await store.generateResponse(mode, { generationId: `normal-${mode}-${stream}` });

    expect(store.activeChat?.messages.at(-1)?.mes).toBe('normal response');
    expect(order.indexOf('before')).toBeLessThan(order.indexOf('message'));
    expect(order.lastIndexOf('message')).toBeLessThan(order.indexOf('after'));
    expect(order.indexOf('after')).toBeLessThan(order.indexOf('finished'));
  });

  it.each([false, true])(
    'orders live ADD_SWIPE events, after-generation, terminal, and final save (stream=%s)',
    async (stream) => {
      vi.useFakeTimers();
      useSettingsStore().settings.api.samplers.stream = stream;
      const order: string[] = [];
      const runtime = runtimeFor([triggerFlow('after', 'trigger.after-generation')], async (request) => {
        order.push('after-generation');
        return completed(request.flow.id, request.state);
      });
      const store = setChat([user(), assistant()]);
      const chatFile = `add-swipe-${stream}`;
      store.activeChatFile = chatFile;
      if (store.activeChat) store.activeChat.fileName = chatFile;
      const streamResponse = async function* () {
        yield { delta: 'normal ' };
        yield { delta: 'response' };
      };
      vi.spyOn(ChatCompletionService, 'generate').mockImplementation(async () =>
        stream ? streamResponse() : { content: 'normal response' },
      );
      const storageSave = vi.spyOn(chatService, 'save').mockImplementation(async (filename) => {
        if (filename === chatFile) order.push('save');
      });
      cleanup.push(
        eventEmitter.on('message:updated', () => order.push('message:updated')),
        eventEmitter.on('message:swipe-changed', () => order.push('message:swipe-changed')),
        eventEmitter.on('generation:finished', () => order.push('generation:finished')),
        eventEmitter.on('generation:aborted', () => order.push('generation:aborted')),
        registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime),
      );

      await store.generateResponse(GenerationMode.ADD_SWIPE, { generationId: `add-swipe-order-${stream}` });
      expect(storageSave.mock.calls.filter(([filename]) => filename === chatFile)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2_000);

      expect(order).toEqual([
        'message:updated',
        'message:swipe-changed',
        'after-generation',
        'generation:finished',
        'save',
      ]);
      expect(order.filter((item) => item.startsWith('generation:'))).toHaveLength(1);
      const persistedSaves = storageSave.mock.calls.filter(([filename]) => filename === chatFile);
      expect(persistedSaves).toHaveLength(1);
      expect(persistedSaves[0]?.[1].at(-1)).toMatchObject({
        mes: 'normal response',
        swipes: ['old', 'normal response'],
        swipe_id: 1,
      });
    },
  );

  it('treats a streaming name-hijack truncation as accepted and completes lifecycle, consumption, and final save', async () => {
    vi.useFakeTimers();
    useSettingsStore().settings.api.samplers.stream = true;
    const order: string[] = [];
    const checkpoint = {
      agents: {
        agent: {
          state: { value: 0 },
          flowEventCounts: {},
          injections: [
            {
              id: 'once',
              flowId: 'seed',
              content: 'remember this',
              placement: 'relative' as const,
              depth: 0,
              lifetime: { type: 'ONCE' as const },
              activation: { type: 'ALWAYS' as const },
            },
          ],
        },
      },
    };
    const source = user();
    source.extra[CUSTOM_AGENTS_CHECKPOINT_KEY] = checkpoint;
    const runtime = runtimeFor([triggerFlow('after', 'trigger.after-generation')], async (request) => {
      order.push('after-generation');
      return completed(request.flow.id, request.state);
    });
    const store = setChat([source]);
    const streamResponse = async function* () {
      yield { delta: 'Accepted response.\n' };
      yield { delta: 'User: hijacked continuation' };
      yield { delta: 'must not be read' };
    };
    vi.spyOn(ChatCompletionService, 'generate').mockResolvedValue(streamResponse());
    const storageSave = vi.spyOn(chatService, 'save').mockImplementation(async (filename) => {
      if (filename === 'chat') order.push('save');
    });
    cleanup.push(
      eventEmitter.on('message:created', (message) => {
        if (!message.is_user) order.push('assistant-created');
      }),
      eventEmitter.on('generation:finished', () => order.push('generation:finished')),
      eventEmitter.on('generation:aborted', () => order.push('generation:aborted')),
      registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime),
    );

    await store.generateResponse(GenerationMode.NEW, { generationId: 'name-hijack-stop' });

    expect(store.activeChat?.messages.at(-1)?.mes).toBe('Accepted response.');
    expect(
      store.activeChat?.messages.at(-1)?.swipe_info[0]?.extra[CUSTOM_AGENTS_CHECKPOINT_KEY].agents.agent.injections,
    ).toEqual([]);
    expect(order).toEqual(['assistant-created', 'after-generation', 'generation:finished']);
    expect(storageSave.mock.calls.filter(([filename]) => filename === 'chat')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(order).toEqual(['assistant-created', 'after-generation', 'generation:finished', 'save']);
    const persistedSaves = storageSave.mock.calls.filter(([filename]) => filename === 'chat');
    expect(persistedSaves).toHaveLength(1);
    expect(persistedSaves[0]?.[1].at(-1)).toMatchObject({ mes: 'Accepted response.' });
  });

  it('keeps extension streaming cancellation aborted and skips after-generation and injection consumption', async () => {
    useSettingsStore().settings.api.samplers.stream = true;
    const checkpoint = {
      agents: {
        agent: {
          state: { value: 0 },
          flowEventCounts: {},
          injections: [
            {
              id: 'once',
              flowId: 'seed',
              content: 'keep on cancellation',
              placement: 'relative' as const,
              depth: 0,
              lifetime: { type: 'ONCE' as const },
              activation: { type: 'ALWAYS' as const },
            },
          ],
        },
      },
    };
    const source = user();
    source.extra[CUSTOM_AGENTS_CHECKPOINT_KEY] = checkpoint;
    const after = vi.fn(async (request: Parameters<GraphCustomAgentsRuntime['execute']>[0]) =>
      completed(request.flow.id, request.state),
    );
    const runtime = runtimeFor([triggerFlow('after', 'trigger.after-generation')], after);
    const store = setChat([source]);
    const streamResponse = async function* () {
      yield { delta: 'accepted partial' };
      yield { delta: 'cancelled chunk' };
    };
    vi.spyOn(ChatCompletionService, 'generate').mockResolvedValue(streamResponse());
    let chunks = 0;
    const finished = vi.fn();
    const aborted = vi.fn();
    cleanup.push(
      eventEmitter.on('process:stream-chunk', (_chunk, { controller }) => {
        chunks++;
        if (chunks === 2) controller.abort();
      }),
      eventEmitter.on('generation:finished', finished),
      eventEmitter.on('generation:aborted', aborted),
      registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime),
    );

    await store.generateResponse(GenerationMode.NEW, { generationId: 'extension-stream-cancel' });

    expect(store.activeChat?.messages.at(-1)?.mes).toBe('accepted partial');
    expect(after).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
    expect(aborted).toHaveBeenCalledOnce();
    expect(
      store.activeChat?.messages[0]?.extra[CUSTOM_AGENTS_CHECKPOINT_KEY].agents.agent.injections.map(
        ({ id }: { id: string }) => id,
      ),
    ).toEqual(['once']);
  });

  it('passes a detached plain clone of Vue-reactive live history through the registered runtime', async () => {
    useSettingsStore().settings.api.samplers.stream = false;
    const liveHistory = reactive([user()]);
    const execute = vi.fn(async (request: Parameters<GraphCustomAgentsRuntime['execute']>[0]) => {
      expect(isReactive(request.chatHistory)).toBe(false);
      expect(isReactive(request.chatHistory[0])).toBe(false);
      expect(() => structuredClone(request.chatHistory)).not.toThrow();
      request.chatHistory[0]!.mes = 'executor mutation';
      request.chatHistory[0]!.extra.executorMutation = true;
      return completed(request.flow.id, request.state);
    });
    const runtime = runtimeFor([triggerFlow('before', 'trigger.before-generation')], execute);
    const store = setChat(liveHistory);
    expect(isReactive(store.activeChat?.messages)).toBe(true);
    expect(isReactive(store.activeChat?.messages[0])).toBe(true);
    vi.spyOn(ChatCompletionService, 'generate').mockResolvedValue({ content: 'normal response' });
    cleanup.push(registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime));

    await expect(
      store.generateResponse(GenerationMode.NEW, { generationId: 'reactive-history-clone' }),
    ).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledOnce();
    expect(liveHistory[0]?.mes).toBe('hello');
    expect(liveHistory[0]?.extra.executorMutation).toBeUndefined();
    expect(store.activeChat?.messages[0]?.mes).toBe('hello');
    expect(store.activeChat?.messages.at(-1)?.mes).toBe('normal response');
  });

  it('persists all generator counts and rejects multiple eligible flows before executing either', async () => {
    const execute = vi.fn();
    const runtime = runtimeFor(
      [
        triggerFlow('generator-a', 'trigger.generate-assistant'),
        triggerFlow('generator-b', 'trigger.generate-assistant'),
      ],
      execute,
    );
    const store = setChat([user()]);
    const provider = vi.spyOn(ChatCompletionService, 'generate');
    cleanup.push(registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime));

    await store.generateResponse(GenerationMode.NEW, { generationId: 'multiple-eligible' });

    expect(execute).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(store.activeChat?.messages[0]?.extra[CUSTOM_AGENTS_CHECKPOINT_KEY].agents.agent.flowEventCounts).toEqual({
      'generator-a': 1,
      'generator-b': 1,
    });
  });

  it('persists scheduled generator progression while normal generation handles ineligible invocations', async () => {
    useSettingsStore().settings.api.samplers.stream = false;
    const execute = vi.fn(async (request) => completed(request.flow.id, request.state, 'scheduled response'));
    const runtime = runtimeFor(
      [
        triggerFlow('generator', 'trigger.generate-assistant', {
          type: 'EVERY_N_EVENTS',
          interval: 2,
        }),
      ],
      execute,
    );
    const store = setChat([user()]);
    const provider = vi.spyOn(ChatCompletionService, 'generate').mockResolvedValue({ content: 'normal response' });
    cleanup.push(registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime));

    await store.generateResponse(GenerationMode.NEW, { generationId: 'scheduled-1' });
    expect(store.activeChat?.messages.at(-1)?.mes).toBe('normal response');
    expect(
      store.activeChat?.messages.at(-1)?.swipe_info[0]?.extra[CUSTOM_AGENTS_CHECKPOINT_KEY].agents.agent.flowEventCounts
        .generator,
    ).toBe(1);

    await store.generateResponse(GenerationMode.NEW, { generationId: 'scheduled-2' });
    expect(store.activeChat?.messages.at(-1)?.mes).toBe('scheduled response');
    expect(provider).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(
      store.activeChat?.messages.at(-1)?.swipe_info[0]?.extra[CUSTOM_AGENTS_CHECKPOINT_KEY].agents.agent.flowEventCounts
        .generator,
    ).toBe(2);
  });

  it('retains direct observer effects and does not fall back after a generator failure', async () => {
    const runtime = runtimeFor(
      [triggerFlow('before', 'trigger.before-generation'), triggerFlow('generator', 'trigger.generate-assistant')],
      async (request) => {
        if (request.flow.id === 'before') {
          const state = { value: 7 };
          await request.onEffectsApplied?.(state, []);
          return completed(request.flow.id, state);
        }
        return { status: 'FAILED', flowId: request.flow.id, error: 'generator failed', diagnostics: [] };
      },
    );
    const store = setChat([user()]);
    const provider = vi.spyOn(ChatCompletionService, 'generate');
    cleanup.push(registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime));

    await store.generateResponse(GenerationMode.NEW, { generationId: 'generator-failure' });

    expect(provider).not.toHaveBeenCalled();
    expect(store.activeChat?.messages).toHaveLength(1);
    expect(store.activeChat?.messages[0]?.extra[CUSTOM_AGENTS_CHECKPOINT_KEY].agents.agent.state.value).toBe(7);
  });

  it('cleans cancelled sessions so the same generation ID can retry', async () => {
    let attempt = 0;
    const runtime = runtimeFor([triggerFlow('generator', 'trigger.generate-assistant')], async (request) => {
      attempt++;
      const state = { value: attempt };
      await request.onEffectsApplied?.(state, []);
      if (attempt === 1) return { status: 'CANCELLED', flowId: request.flow.id, diagnostics: [] };
      return completed(request.flow.id, state, 'retry response');
    });
    const store = setChat([user()]);
    cleanup.push(registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime));

    await store.generateResponse(GenerationMode.NEW, { generationId: 'same-id' });
    await store.generateResponse(GenerationMode.NEW, { generationId: 'same-id' });

    expect(attempt).toBe(2);
    expect(store.activeChat?.messages.at(-1)?.mes).toBe('retry response');
  });

  it.each(['start-abort', 'provider-error', 'response-abort'] as const)(
    'finalizes %s exits so the same generation ID can retry',
    async (exit) => {
      useSettingsStore().settings.api.samplers.stream = false;
      const runtime = runtimeFor(
        [
          triggerFlow('generator', 'trigger.generate-assistant', {
            type: 'EVERY_N_EVENTS',
            interval: 10,
          }),
        ],
        vi.fn(),
      );
      const store = setChat([user()]);
      const provider = vi.spyOn(ChatCompletionService, 'generate');
      if (exit === 'provider-error')
        provider
          .mockRejectedValueOnce(new Error('provider failed'))
          .mockResolvedValueOnce({ content: 'retry response' });
      else provider.mockResolvedValue({ content: 'retry response' });
      let starts = 0;
      let responses = 0;
      if (exit === 'start-abort')
        cleanup.push(
          eventEmitter.on('generation:started', ({ controller }) => {
            starts++;
            if (starts === 1) controller.abort();
          }),
        );
      if (exit === 'response-abort')
        cleanup.push(
          eventEmitter.on('process:response', (_response, { controller }) => {
            responses++;
            if (responses === 1) controller.abort();
          }),
        );
      cleanup.push(registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime));

      await store.generateResponse(GenerationMode.NEW, { generationId: 'retry-terminal' });
      await store.generateResponse(GenerationMode.NEW, { generationId: 'retry-terminal' });

      expect(store.activeChat?.messages.at(-1)?.mes).toBe('retry response');
      expect(
        store.activeChat?.messages.at(-1)?.swipe_info[0]?.extra[CUSTOM_AGENTS_CHECKPOINT_KEY].agents.agent
          .flowEventCounts.generator,
      ).toBe(2);
    },
  );

  it('cleans no-speaker sessions, controller state, and activation lifetime for same-ID retry', async () => {
    const runtime = runtimeFor(
      [
        triggerFlow('generator', 'trigger.generate-assistant', {
          type: 'EVERY_N_EVENTS',
          interval: 10,
        }),
      ],
      vi.fn(),
    );
    const store = setChat([user()]);
    const characters = useCharacterStore();
    characters.characters = [];
    characters.setActiveCharacterAvatars([]);
    const firstRegistration = registerGraphCustomAgentsGeneration(
      extensionAPI as unknown as CustomAgentsHostAPI,
      runtime,
    );
    const finished = vi.fn();
    cleanup.push(eventEmitter.on('generation:finished', finished));

    await store.generateResponse(GenerationMode.NEW, { generationId: 'no-speaker' });
    await store.generateResponse(GenerationMode.NEW, { generationId: 'no-speaker' });
    expect(finished).toHaveBeenCalledTimes(2);
    expect(
      store.activeChat?.messages[0]?.extra[CUSTOM_AGENTS_CHECKPOINT_KEY].agents.agent.flowEventCounts.generator,
    ).toBe(2);

    firstRegistration();
    useSettingsStore().settings.api.samplers.stream = false;
    vi.spyOn(ChatCompletionService, 'generate').mockResolvedValue({ content: 'normal response' });
    characters.characters = [character];
    characters.setActiveCharacterAvatars([character.avatar]);
    cleanup.push(registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime));
    await store.generateResponse(GenerationMode.NEW, { generationId: 'no-speaker' });
    expect(
      store.activeChat?.messages[0]?.extra[CUSTOM_AGENTS_CHECKPOINT_KEY].agents.agent.flowEventCounts.generator,
    ).toBe(3);
  });

  it('consumes only graph-prompt acknowledgements reported by the response-producing flow', async () => {
    const checkpoint = {
      agents: {
        agent: {
          state: { value: 0 },
          flowEventCounts: {},
          injections: ['included', 'excluded'].map((id) => ({
            id,
            flowId: 'seed',
            content: id,
            placement: 'relative' as const,
            depth: 0,
            lifetime: { type: 'ONCE' as const },
            activation: { type: 'ALWAYS' as const },
          })),
        },
      },
    };
    const message = user();
    message.extra[CUSTOM_AGENTS_CHECKPOINT_KEY] = checkpoint;
    let runtime!: TestRuntime;
    runtime = runtimeFor([triggerFlow('generator', 'trigger.generate-assistant')], async (request) => {
      const active = runtime.currentGenerationInjections()!;
      active.acknowledge([active.injections.find(({ content }) => content === 'included')!.id]);
      return completed(request.flow.id, request.state, 'acknowledged response');
    });
    const store = setChat([message]);
    cleanup.push(registerGraphCustomAgentsGeneration(extensionAPI as unknown as CustomAgentsHostAPI, runtime));

    await store.generateResponse(GenerationMode.NEW, { generationId: 'acknowledged' });

    const persisted = store.activeChat?.messages.at(-1)?.swipe_info[0]?.extra[CUSTOM_AGENTS_CHECKPOINT_KEY];
    expect(persisted.agents.agent.injections.map(({ id }: { id: string }) => id)).toEqual(['excluded']);
  });

  it('persists a checkpoint-only manual action once without message events or delayed autosave', async () => {
    vi.useFakeTimers();
    const runtime = runtimeFor([triggerFlow('manual', 'trigger.manual')], async (request) => {
      const state = { value: 1 };
      await request.onEffectsApplied?.(state, []);
      return completed(request.flow.id, state);
    });
    setChat([user()]);
    const storageSave = vi.spyOn(chatService, 'save').mockResolvedValue(undefined);
    const updated = vi.fn();
    cleanup.push(eventEmitter.on('message:updated', updated));

    await runGraphManualFlow(
      extensionAPI as unknown as CustomAgentsHostAPI,
      runtime,
      'agent',
      'manual',
      null,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(2_000);

    expect(storageSave).toHaveBeenCalledOnce();
    expect(updated).not.toHaveBeenCalled();
  });
});
