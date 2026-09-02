import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatMetadata } from '../../src/types';
import type { GraphPreset, JsonObject } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import type { CustomAgentsHostAPI } from '../../src/extensions/built-in/custom-agents/host/api';
import {
  activateCheckpointInjections,
  emptyCheckpoint,
} from '../../src/extensions/built-in/custom-agents/host/checkpoints';
import { runGraphManualFlow } from '../../src/extensions/built-in/custom-agents/host/generation';
import { GraphTriggerLifecycle } from '../../src/extensions/built-in/custom-agents/host/lifecycle';
import {
  compileGraphAgents,
  type GraphCustomAgentsRuntime,
} from '../../src/extensions/built-in/custom-agents/host/runtime';
import { validateInstalledGraphAgentsSettings } from '../../src/extensions/built-in/custom-agents/settings/store';

const modes = ['NEW', 'REGENERATE', 'ADD_SWIPE'];

function triggerFlow(
  id: string,
  type: string,
  effectType = 'effect.set-state',
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
            : { generationModes: modes, schedule },
        inputValues: {},
      },
      {
        id: `${id}-effect`,
        type: effectType,
        position: { x: 1, y: 0 },
        data: effectType === 'effect.generation-response' ? {} : { path: 'value' },
        inputValues: effectType === 'effect.generation-response' ? { content: 'response' } : { value: 1 },
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

function preset(flows: GraphPreset['agent']['flows'], id = 'agent'): GraphPreset {
  return {
    format: 'NEOTAVERN_CUSTOM_AGENT_FLOW',
    agent: {
      id,
      name: id,
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

function userMessage(): ChatMessage {
  return {
    name: 'User',
    mes: 'hello',
    is_user: true,
    is_system: false,
    original_avatar: 'persona',
    send_date: '',
    swipes: ['hello'],
    swipe_id: 0,
    swipe_info: [{ send_date: '', extra: {} }],
    extra: {},
  };
}

describe('Custom Agent direct host integration', () => {
  it('consumes only acknowledged finite-lifetime prompt injections', () => {
    const checkpoint = {
      agents: {
        agent: {
          state: {},
          flowEventCounts: {},
          injections: [
            {
              id: 'included',
              flowId: 'flow',
              content: 'included',
              placement: 'relative' as const,
              depth: 0,
              lifetime: { type: 'ONCE' as const },
              activation: { type: 'ALWAYS' as const },
            },
            {
              id: 'excluded',
              flowId: 'flow',
              content: 'excluded',
              placement: 'relative' as const,
              depth: 0,
              lifetime: { type: 'ONCE' as const },
              activation: { type: 'ALWAYS' as const },
            },
          ],
        },
      },
    };
    const active = activateCheckpointInjections(checkpoint, () => 0, new AbortController().signal);
    const includedId = active.promptInjections.find(({ content }) => content === 'included')!.id;
    active.acknowledge([includedId]);
    active.consume(checkpoint);
    expect(checkpoint.agents.agent.injections.map(({ id }) => id)).toEqual(['excluded']);
  });

  it('rejects a second enabled generation-capable agent during settings validation', () => {
    const first = preset([triggerFlow('first', 'trigger.generate-assistant', 'effect.generation-response')], 'first');
    const second = preset(
      [triggerFlow('second', 'trigger.generate-assistant', 'effect.generation-response')],
      'second',
    );
    expect(() => validateInstalledGraphAgentsSettings({ presets: [first, second] })).toThrow(
      'Only one enabled generation-capable Custom Agent',
    );
  });

  it('advances all generation schedules before detecting multiple eligible flows', async () => {
    const agents = compileGraphAgents([
      preset([
        triggerFlow('first', 'trigger.generate-assistant', 'effect.generation-response'),
        triggerFlow('second', 'trigger.generate-assistant', 'effect.generation-response'),
      ]),
    ]);
    const execute = vi.fn();
    const lifecycle = new GraphTriggerLifecycle(
      () => agents,
      { execute },
      { random: { next: () => 0 }, ids: { generate: () => 'id' } },
    );
    const prepared = await lifecycle.prepareGenerationFlows(emptyCheckpoint(), {
      trigger: 'ASSISTANT_GENERATION',
      generationId: 'generation',
      generationMode: 'NEW',
    });
    expect(prepared.eligible.map(({ flow }) => flow.id)).toEqual(['first', 'second']);
    expect(prepared.checkpoint.agents.agent?.flowEventCounts).toEqual({ first: 1, second: 1 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('advances an ineligible generation schedule exactly once per invocation', async () => {
    const agents = compileGraphAgents([
      preset([
        triggerFlow('scheduled', 'trigger.generate-assistant', 'effect.generation-response', {
          type: 'EVERY_N_EVENTS',
          interval: 2,
        }),
      ]),
    ]);
    const lifecycle = new GraphTriggerLifecycle(
      () => agents,
      { execute: vi.fn() },
      { random: { next: () => 0 }, ids: { generate: () => 'id' } },
    );
    const event = {
      trigger: 'ASSISTANT_GENERATION' as const,
      generationId: 'generation',
      generationMode: 'NEW' as const,
    };
    const first = await lifecycle.prepareGenerationFlows(emptyCheckpoint(), event);
    expect(first.eligible).toEqual([]);
    expect(first.checkpoint.agents.agent?.flowEventCounts.scheduled).toBe(1);
    const second = await lifecycle.prepareGenerationFlows(first.checkpoint, event);
    expect(second.eligible.map(({ flow }) => flow.id)).toEqual(['scheduled']);
    expect(second.checkpoint.agents.agent?.flowEventCounts.scheduled).toBe(2);
  });

  it('persists one successful manual flow through exactly one awaited chat save', async () => {
    const agents = compileGraphAgents([preset([triggerFlow('manual', 'trigger.manual')])]);
    const live = {
      chatFile: 'chat',
      integrity: 'integrity',
      metadata: { integrity: 'integrity' } as ChatMetadata,
      messages: [userMessage()],
    };
    const save = vi.fn(async () => undefined);
    const setExtensionData = vi.fn(
      (
        location:
          | { type: 'chat' }
          | { type: 'message'; index: number }
          | { type: 'swipe'; messageIndex: number; swipeIndex: number },
        key: string,
        value: unknown,
      ) => {
        const extra =
          location.type === 'chat'
            ? (live.metadata.extra ??= {})
            : location.type === 'message'
              ? live.messages[location.index]!.extra
              : live.messages[location.messageIndex]!.swipe_info[location.swipeIndex]!.extra;
        if (value === undefined) delete extra[key];
        else extra[key] = structuredClone(value);
      },
    );
    const runtime = {
      getAgents: () => agents,
      execute: vi.fn(async (request) => {
        await request.onEffectsApplied?.({ value: 1 }, [{ type: 'STATE_SET', path: 'value', value: 1 }]);
        return {
          status: 'COMPLETED',
          flowId: request.flow.id,
          state: { value: 1 },
          effects: [{ type: 'STATE_SET', path: 'value', value: 1 }],
          diagnostics: [],
        };
      }),
    } as unknown as GraphCustomAgentsRuntime;
    const api = {
      uuid: () => 'id',
      chat: {
        getHistory: () => structuredClone(live.messages),
        getChatExtensionData: (key: string) => structuredClone(live.metadata.extra?.[key]),
        updateMessageObject: vi.fn(),
        setExtensionData,
        updateMessage: vi.fn(),
        createMessage: vi.fn(),
        save,
      },
    } as unknown as CustomAgentsHostAPI;

    await runGraphManualFlow(api, runtime, 'agent', 'manual', null, new AbortController().signal);

    expect(save).toHaveBeenCalledOnce();
    expect(setExtensionData).toHaveBeenCalled();
    expect(api.chat.updateMessageObject).not.toHaveBeenCalled();
  });

  it('keeps a completed direct effect when a later node fails', async () => {
    const agents = compileGraphAgents([preset([triggerFlow('manual', 'trigger.manual')])]);
    const checkpoints: JsonObject[] = [];
    const lifecycle = new GraphTriggerLifecycle(
      () => agents,
      {
        execute: async (request) => {
          await request.onEffectsApplied?.({ value: 1 }, [{ type: 'STATE_SET', path: 'value', value: 1 }]);
          return { status: 'FAILED', flowId: request.flow.id, error: 'later node failed', diagnostics: [] };
        },
      },
      { random: { next: () => 0 }, ids: { generate: () => 'id' } },
    );
    await expect(
      lifecycle.run(emptyCheckpoint(), { trigger: 'MANUAL', input: null }, new AbortController().signal, [], {
        onCheckpoint: (checkpoint) => checkpoints.push(structuredClone(checkpoint) as unknown as JsonObject),
      }),
    ).rejects.toThrow('later node failed');
    expect(checkpoints.at(-1)).toMatchObject({ agents: { agent: { state: { value: 1 } } } });
  });
});
