import { GenerationMode } from '../../../../constants';
import {
  registerChatLifecycleHooks,
  type AfterGenerationContext,
  type AfterUserMessageContext,
  type BeforeGenerationContext,
  type BeforeGenerationResult,
} from '../../../../services/chat-lifecycle';
import type { ChatMessage, ChatMetadata } from '../../../../types';
import type { JsonValue } from '../generic/json';
import type { GraphAgent } from '../graph/contracts';
import type { GraphNodeEffect } from '../registry/node-definition';
import {
  activateCheckpointInjections,
  checkpointAtTip,
  generationParentCheckpoint,
  resetSelectedAgent,
  CUSTOM_AGENTS_CHECKPOINT_KEY,
  writeMessageCheckpoint,
  writeRootCheckpoint,
  writeSelectedTipCheckpoint,
} from './checkpoints';
import type { CustomAgentsHostAPI } from './api';
import type {
  CustomAgentEvent,
  CustomAgentsCheckpoint,
  GenerationMode as AgentGenerationMode,
  MessageValue,
} from './contracts';
import { GraphTriggerLifecycle } from './lifecycle';
import type { GraphCustomAgentsRuntime } from './runtime';

function agentMode(mode: GenerationMode): AgentGenerationMode {
  if (mode === GenerationMode.NEW) return 'NEW';
  if (mode === GenerationMode.REGENERATE) return 'REGENERATE';
  if (mode === GenerationMode.ADD_SWIPE) return 'ADD_SWIPE';
  throw new Error(`Unsupported Custom Agents generation mode ${mode}`);
}

function messageValue(message: ChatMessage, index: number): MessageValue {
  return {
    index,
    role: message.is_system ? 'SYSTEM' : message.is_user ? 'USER' : 'ASSISTANT',
    name: message.name,
    content: message.mes,
    ...(!message.is_user && !message.is_system ? { swipeIndex: message.swipe_id ?? 0 } : {}),
  };
}

function activeCheckpointContext(api: CustomAgentsHostAPI): {
  messages: ChatMessage[];
  metadata: ChatMetadata;
} {
  const checkpoint = api.chat.getChatExtensionData(CUSTOM_AGENTS_CHECKPOINT_KEY);
  return {
    messages: api.chat.getHistory(),
    metadata: {
      integrity: '',
      ...(checkpoint === undefined ? {} : { extra: { [CUSTOM_AGENTS_CHECKPOINT_KEY]: checkpoint } }),
    },
  };
}

function selectedTarget(messages: readonly ChatMessage[]): MessageValue | undefined {
  const index = messages.length - 1;
  return index < 0 ? undefined : messageValue(messages[index]!, index);
}

function targetEvent(
  messages: ChatMessage[],
  trigger: 'BEFORE_ASSISTANT_GENERATION' | 'ASSISTANT_GENERATION',
  generationId: string,
  mode: AgentGenerationMode,
): CustomAgentEvent {
  const target = mode === 'NEW' ? undefined : messages[messages.length - 1];
  return {
    trigger,
    generationId,
    generationMode: mode,
    ...(target ? { targetMessage: messageValue(target, messages.length - 1) } : {}),
  };
}

function createLifecycle(
  api: CustomAgentsHostAPI,
  runtime: GraphCustomAgentsRuntime,
  random: (() => number) | undefined,
): GraphTriggerLifecycle {
  return new GraphTriggerLifecycle(runtime.getAgents, runtime, {
    random: { next: random ?? Math.random },
    ids: { generate: api.uuid },
  });
}

function visibleEffectHandler(
  api: CustomAgentsHostAPI,
  targetIndex: number | undefined,
): (effect: Extract<GraphNodeEffect, { type: 'VISIBLE_MESSAGE' }>) => Promise<void> {
  return async (effect) => {
    if (effect.operation === 'CREATE') {
      await api.chat.createMessage({ role: 'assistant', name: 'Custom Agent', content: effect.content });
      return;
    }
    if (targetIndex === undefined) throw new Error(`${effect.operation} requires a target message`);
    const target = api.chat.getHistory()[targetIndex];
    if (!target) throw new Error('Lifecycle target message is unavailable');
    await api.chat.updateMessage(
      targetIndex,
      effect.operation === 'REPLACE_TARGET' ? effect.content : `${target.mes}${effect.content}`,
    );
  };
}

async function persistSelectedCheckpoint(
  api: CustomAgentsHostAPI,
  messages: ChatMessage[],
  metadata: ChatMetadata,
  checkpoint: CustomAgentsCheckpoint,
): Promise<void> {
  writeSelectedTipCheckpoint(messages, metadata, checkpoint);
  const index = messages.length - 1;
  if (index < 0) {
    api.chat.setExtensionData(
      { type: 'chat' },
      CUSTOM_AGENTS_CHECKPOINT_KEY,
      metadata.extra?.[CUSTOM_AGENTS_CHECKPOINT_KEY],
    );
    return;
  }
  const message = messages[index]!;
  api.chat.setExtensionData({ type: 'chat' }, CUSTOM_AGENTS_CHECKPOINT_KEY, undefined);
  api.chat.setExtensionData(
    { type: 'message', index },
    CUSTOM_AGENTS_CHECKPOINT_KEY,
    message.extra[CUSTOM_AGENTS_CHECKPOINT_KEY],
  );
  if (!message.is_user && !message.is_system)
    api.chat.setExtensionData(
      { type: 'swipe', messageIndex: index, swipeIndex: message.swipe_id ?? 0 },
      CUSTOM_AGENTS_CHECKPOINT_KEY,
      message.swipe_info[message.swipe_id ?? 0]?.extra[CUSTOM_AGENTS_CHECKPOINT_KEY],
    );
}

export async function resetSelectedGraphAgent(
  api: CustomAgentsHostAPI,
  agent: Pick<GraphAgent, 'id' | 'initialState' | 'stateSchema'>,
): Promise<void> {
  const context = activeCheckpointContext(api);
  const checkpoint = resetSelectedAgent(checkpointAtTip(context.messages, context.metadata), agent);
  await persistSelectedCheckpoint(api, context.messages, context.metadata, checkpoint);
  await api.chat.save();
}

export async function runManagedGraphManualFlow(
  api: CustomAgentsHostAPI,
  runtime: GraphCustomAgentsRuntime,
  agentId: string,
  flowId: string,
  input: JsonValue,
  options: { random?: () => number } = {},
): Promise<void> {
  const signal = runtime.beginManual(agentId);
  try {
    await runGraphManualFlow(api, runtime, agentId, flowId, input, signal, options);
  } finally {
    runtime.finishManual(agentId, signal);
  }
}

export async function runGraphManualFlow(
  api: CustomAgentsHostAPI,
  runtime: GraphCustomAgentsRuntime,
  agentId: string,
  flowId: string,
  input: JsonValue,
  signal: AbortSignal,
  options: { random?: () => number } = {},
): Promise<void> {
  const agent = runtime
    .getAgents()
    .find((candidate) => candidate.definition.id === agentId && candidate.definition.enabled);
  const flow = agent?.plan.agent.flows.find(
    (candidate) => candidate.id === flowId && candidate.kind === 'TRIGGER' && candidate.trigger?.event === 'MANUAL',
  );
  if (!agent || !flow) throw new Error(`Manual flow ${agentId}/${flowId} is not available`);
  const context = activeCheckpointContext(api);
  const lifecycle = createLifecycle(api, runtime, options.random);
  const target = selectedTarget(context.messages);
  const result = await lifecycle.run(
    checkpointAtTip(context.messages, context.metadata),
    { trigger: 'MANUAL', input },
    signal,
    context.messages,
    {
      flowIds: new Set([`${agentId}/${flowId}`]),
      ...(target ? { targetMessage: target } : {}),
      onCheckpoint: async (checkpoint) => {
        const current = activeCheckpointContext(api);
        await persistSelectedCheckpoint(api, current.messages, current.metadata, checkpoint);
      },
      onVisibleMessage: visibleEffectHandler(api, target?.index),
    },
  );
  const current = activeCheckpointContext(api);
  await persistSelectedCheckpoint(api, current.messages, current.metadata, result.checkpoint);
  await api.chat.save();
}

export function registerGraphCustomAgentsGeneration(
  api: CustomAgentsHostAPI,
  runtime: GraphCustomAgentsRuntime,
  options: { random?: () => number } = {},
): () => void {
  const lifecycle = createLifecycle(api, runtime, options.random);
  const sessions = new Map<
    string,
    {
      checkpoint: CustomAgentsCheckpoint;
      injections: ReturnType<typeof activateCheckpointInjections>;
      mode: AgentGenerationMode;
    }
  >();

  const unregisterHooks = registerChatLifecycleHooks({
    async afterUserMessage(context: AfterUserMessageContext): Promise<void> {
      const message = context.messages[context.messageIndex];
      if (!message?.is_user) throw new Error('AFTER_USER_MESSAGE requires a user target');
      const result = await lifecycle.run(
        checkpointAtTip(context.messages, context.metadata),
        { trigger: 'AFTER_USER_MESSAGE', message: messageValue(message, context.messageIndex) },
        context.signal,
        context.messages,
        {
          onCheckpoint: (checkpoint) => writeMessageCheckpoint(message, checkpoint, context.metadata),
          onVisibleMessage: visibleEffectHandler(api, context.messageIndex),
        },
      );
      writeMessageCheckpoint(message, result.checkpoint, context.metadata);
    },

    async beforeGeneration(context: BeforeGenerationContext): Promise<BeforeGenerationResult | void> {
      const mode = agentMode(context.generationMode);
      if (sessions.has(context.generationId)) throw new Error(`Duplicate generation lifecycle ${context.generationId}`);
      let checkpoint = generationParentCheckpoint(context.messages, context.metadata, mode);
      const beforeEvent = targetEvent(context.messages, 'BEFORE_ASSISTANT_GENERATION', context.generationId, mode);
      const checkpointTarget =
        mode === 'REGENERATE'
          ? context.messages[context.messages.length - 2]
          : context.messages[context.messages.length - 1];
      const persistGenerationCheckpoint = (value: CustomAgentsCheckpoint): void => {
        if (checkpointTarget) writeMessageCheckpoint(checkpointTarget, value, context.metadata);
        else writeRootCheckpoint(context.metadata, value);
      };
      const before = await lifecycle.run(checkpoint, beforeEvent, context.signal, context.history, {
        onCheckpoint: persistGenerationCheckpoint,
        onVisibleMessage: visibleEffectHandler(api, context.target?.messageIndex),
      });
      checkpoint = before.checkpoint;

      const generationEvent = targetEvent(context.messages, 'ASSISTANT_GENERATION', context.generationId, mode);
      const prepared = await lifecycle.prepareGenerationFlows(checkpoint, generationEvent, persistGenerationCheckpoint);
      checkpoint = prepared.checkpoint;
      if (prepared.eligible.length > 1)
        throw new Error(
          `Multiple assistant-generation flows are eligible: ${prepared.eligible
            .map(({ agent, flow }) => `${agent.definition.id}/${flow.id}`)
            .join(', ')}`,
        );

      const injections = activateCheckpointInjections(checkpoint, options.random ?? Math.random, context.signal);
      context.promptInjections.push(...injections.promptInjections);
      sessions.set(context.generationId, { checkpoint, injections, mode });
      if (prepared.eligible.length === 0) return;

      const selected = prepared.eligible[0]!;
      const selectedFlowId = `${selected.agent.definition.id}/${selected.flow.id}`;
      runtime.setGenerationInjections(context.generationId, {
        injections: injections.promptInjections,
        acknowledge: injections.acknowledge,
      });
      try {
        const generated = await lifecycle.run(checkpoint, generationEvent, context.signal, context.messages, {
          flowIds: new Set([selectedFlowId]),
          assumeEligibleFlowIds: new Set([selectedFlowId]),
          alreadyAdvancedFlowIds: prepared.advancedFlowIds,
          onCheckpoint: persistGenerationCheckpoint,
          onVisibleMessage: visibleEffectHandler(api, context.target?.messageIndex),
        });
        if (generated.response === undefined) throw new Error('Assistant-generation flow did not supply a response');
        checkpoint = generated.checkpoint;
        sessions.set(context.generationId, { checkpoint, injections, mode });
        return {
          assistantContent: generated.response,
          includedPromptInjectionIds: [...injections.acknowledgedIds],
        };
      } finally {
        runtime.setGenerationInjections(context.generationId, undefined);
      }
    },

    async afterGeneration(context: AfterGenerationContext): Promise<void> {
      const session = sessions.get(context.generationId);
      if (!session) return;
      sessions.delete(context.generationId);
      session.injections.acknowledge(context.includedPromptInjectionIds);
      session.injections.consume(session.checkpoint);
      writeMessageCheckpoint(context.message, session.checkpoint, context.metadata);
      const index = context.messages.indexOf(context.message);
      const event: CustomAgentEvent = {
        trigger: 'AFTER_ASSISTANT_MESSAGE',
        generationId: context.generationId,
        generationMode: session.mode,
        message: messageValue(context.message, index),
      };
      const after = await lifecycle.run(session.checkpoint, event, context.signal, context.history, {
        onCheckpoint: (checkpoint) => writeMessageCheckpoint(context.message, checkpoint, context.metadata),
        onVisibleMessage: visibleEffectHandler(api, index),
      });
      writeMessageCheckpoint(context.message, after.checkpoint, context.metadata);
    },
  });

  const unregisterAborted = api.events.on('generation:aborted', ({ generationId }) => {
    sessions.delete(generationId);
  });
  const unregisterFinished = api.events.on('generation:finished', (_result, { generationId }) => {
    sessions.delete(generationId);
    runtime.setGenerationInjections(generationId, undefined);
  });
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    unregisterHooks();
    unregisterAborted();
    unregisterFinished();
    sessions.clear();
  };
}
