import type { ChatMessage, ChatMetadata, PromptInjection } from '../../../../types';
import type { GraphAgent } from '../graph/contracts';
import { validateSchemaValue } from '../generic/schema';
import { assertValid } from '../generic/validation';
import type { ActiveInjection, AgentCheckpoint, CustomAgentsCheckpoint, GenerationMode } from './contracts';
import { validateCheckpoint } from './schemas';

export const CUSTOM_AGENTS_CHECKPOINT_KEY = 'core.custom-agents';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function agentScopedPromptInjectionId(agentId: string, injectionId: string): string {
  return JSON.stringify([agentId, injectionId]);
}

export function emptyCheckpoint(): CustomAgentsCheckpoint {
  return { agents: {} };
}

function checkpointProperty(extra: Record<string, unknown> | undefined): CustomAgentsCheckpoint | undefined {
  if (!extra || !Object.hasOwn(extra, CUSTOM_AGENTS_CHECKPOINT_KEY)) return undefined;
  return assertValid(validateCheckpoint(extra[CUSTOM_AGENTS_CHECKPOINT_KEY], 'persisted custom-agents checkpoint'));
}

type CheckpointAgent = Pick<GraphAgent, 'id' | 'initialState' | 'stateSchema'>;

export function initialAgentCheckpoint(agent: CheckpointAgent): AgentCheckpoint {
  return { state: clone(agent.initialState), injections: [], flowEventCounts: {} };
}

export function ensureAgentCheckpoint(checkpoint: CustomAgentsCheckpoint, agent: CheckpointAgent): AgentCheckpoint {
  const existing = checkpoint.agents[agent.id];
  if (existing) {
    const checked = validateSchemaValue(agent.stateSchema, existing.state, `checkpoint state for ${agent.id}`);
    if (!checked.valid) throw new Error(checked.errors.join('; '));
    return existing;
  }
  const created = initialAgentCheckpoint(agent);
  checkpoint.agents[agent.id] = created;
  return created;
}

export function rootCheckpoint(metadata: ChatMetadata): CustomAgentsCheckpoint {
  return clone(checkpointProperty(metadata.extra) ?? emptyCheckpoint());
}

export function messageCheckpoint(message: ChatMessage): CustomAgentsCheckpoint | undefined {
  if (!message.is_user && !message.is_system) {
    const swipe = message.swipe_info?.[message.swipe_id ?? 0];
    const checkpoint = checkpointProperty(swipe?.extra);
    const mirrored = checkpointProperty(message.extra);
    if (checkpoint && mirrored && JSON.stringify(checkpoint) !== JSON.stringify(mirrored))
      throw new Error('Selected assistant checkpoint mirror does not match swipe checkpoint');
    return clone(checkpoint ?? mirrored);
  }
  const checkpoint = checkpointProperty(message.extra);
  return checkpoint ? clone(checkpoint) : undefined;
}

export function checkpointAtTip(messages: readonly ChatMessage[], metadata: ChatMetadata): CustomAgentsCheckpoint {
  for (let index = messages.length - 1; index >= 0; index--) {
    const checkpoint = messageCheckpoint(messages[index]!);
    if (checkpoint) return checkpoint;
  }
  return rootCheckpoint(metadata);
}

export function generationParentCheckpoint(
  messages: readonly ChatMessage[],
  metadata: ChatMetadata,
  mode: GenerationMode,
): CustomAgentsCheckpoint {
  if (mode === 'NEW') return checkpointAtTip(messages, metadata);
  const target = messages[messages.length - 1];
  if (!target || target.is_user || target.is_system) throw new Error(`${mode} requires an assistant target message`);
  return checkpointAtTip(messages.slice(0, -1), metadata);
}

function writeExtra(extra: Record<string, unknown>, checkpoint: CustomAgentsCheckpoint): void {
  extra[CUSTOM_AGENTS_CHECKPOINT_KEY] = clone(assertValid(validateCheckpoint(checkpoint)));
}

export function writeRootCheckpoint(metadata: ChatMetadata, checkpoint: CustomAgentsCheckpoint): void {
  if (!metadata.extra) metadata.extra = {};
  writeExtra(metadata.extra, checkpoint);
}

function removeRootCheckpoint(metadata: ChatMetadata): void {
  if (!metadata.extra) return;
  delete metadata.extra[CUSTOM_AGENTS_CHECKPOINT_KEY];
  if (Object.keys(metadata.extra).length === 0) delete metadata.extra;
}

export function writeMessageCheckpoint(
  message: ChatMessage,
  checkpoint: CustomAgentsCheckpoint,
  metadata: ChatMetadata,
): void {
  removeRootCheckpoint(metadata);
  if (message.is_user || message.is_system) {
    writeExtra(message.extra, checkpoint);
    return;
  }
  const swipeIndex = message.swipe_id ?? 0;
  const swipeInfo = message.swipe_info?.[swipeIndex];
  if (!swipeInfo) throw new Error(`Assistant swipe ${swipeIndex} is missing swipe_info`);
  writeExtra(swipeInfo.extra, checkpoint);
  writeExtra(message.extra, checkpoint);
}

export function writeSelectedTipCheckpoint(
  messages: ChatMessage[],
  metadata: ChatMetadata,
  checkpoint: CustomAgentsCheckpoint,
): void {
  const tip = messages[messages.length - 1];
  if (tip) writeMessageCheckpoint(tip, checkpoint, metadata);
  else writeRootCheckpoint(metadata, checkpoint);
}

export interface ActivatedInjections {
  promptInjections: PromptInjection[];
  acknowledgedIds: Set<string>;
  acknowledge(ids: readonly string[]): void;
  consume(checkpoint: CustomAgentsCheckpoint): void;
}

export function activateCheckpointInjections(
  checkpoint: CustomAgentsCheckpoint,
  random: () => number,
  signal: AbortSignal,
): ActivatedInjections {
  const active = new Map<string, { agentId: string; injection: ActiveInjection }>();
  const promptInjections: PromptInjection[] = [];
  for (const agentId of Object.keys(checkpoint.agents).sort()) {
    for (const injection of checkpoint.agents[agentId]!.injections) {
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const included = injection.activation.type === 'ALWAYS' || random() < injection.activation.probability;
      if (!included) continue;
      const id = agentScopedPromptInjectionId(agentId, injection.id);
      active.set(id, { agentId, injection });
      promptInjections.push({
        id,
        content: injection.content,
        role: 'system',
        name: 'Custom Agent',
        placement: injection.placement,
        depth: injection.depth,
      });
    }
  }
  const acknowledgedIds = new Set<string>();
  return {
    promptInjections,
    acknowledgedIds,
    acknowledge(ids) {
      for (const id of ids) if (active.has(id)) acknowledgedIds.add(id);
    },
    consume(target) {
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      for (const id of acknowledgedIds) {
        const selected = active.get(id);
        if (!selected) continue;
        const injections = target.agents[selected.agentId]?.injections;
        const index = injections?.findIndex((item) => item.id === selected.injection.id) ?? -1;
        if (!injections || index < 0) continue;
        const current = injections[index]!;
        if (JSON.stringify(current) !== JSON.stringify(selected.injection)) continue;
        if (current.lifetime.type === 'ONCE') injections.splice(index, 1);
        else if (current.lifetime.type === 'FOR_N_GENERATIONS') {
          current.lifetime.remaining--;
          if (current.lifetime.remaining === 0) injections.splice(index, 1);
        }
      }
    },
  };
}

export function resetSelectedAgent(checkpoint: CustomAgentsCheckpoint, agent: CheckpointAgent): CustomAgentsCheckpoint {
  const next = clone(checkpoint);
  next.agents[agent.id] = initialAgentCheckpoint(agent);
  return next;
}

export function removeSelectedInjection(
  checkpoint: CustomAgentsCheckpoint,
  agentId: string,
  injectionId: string,
): CustomAgentsCheckpoint {
  const next = clone(checkpoint);
  const agent = next.agents[agentId];
  if (agent) agent.injections = agent.injections.filter((injection) => injection.id !== injectionId);
  return next;
}
