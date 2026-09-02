import { cloneDeep } from 'lodash-es';
import { toRaw } from 'vue';
import type { ChatMessage } from '../../../../types';
import type { GraphAgent, JsonObject, JsonValue } from '../graph/contracts';
import type { CompiledFlowPlan, CompiledPresetPlan } from '../graph/plan-types';
import type {
  EligibilityCondition,
  EligibilityReference,
  EligibilityValue,
  IdSource,
  RandomSource,
  GraphNodeEffect,
  TriggerDeclaration,
} from '../registry/node-definition';
import type { GraphExecutionResult } from '../runtime/execute-plan';
import { validateSchemaValue } from '../generic/schema';
import { assertValid } from '../generic/validation';
import type { ActiveInjection, CustomAgentEvent, CustomAgentsCheckpoint, MessageValue } from './contracts';
import { ensureAgentCheckpoint } from './checkpoints';
import { validateCheckpoint } from './schemas';

function clone<Value>(value: Value): Value {
  return cloneDeep(toRaw(value));
}

export type CompiledGraphAgent = {
  definition: Readonly<GraphAgent>;
  plan: CompiledPresetPlan;
};

export type EligibleTriggerFlow = {
  agent: CompiledGraphAgent;
  flow: CompiledFlowPlan;
  declaration: Readonly<TriggerDeclaration>;
};

export interface GraphLifecycleExecutor {
  execute(request: {
    agent: CompiledGraphAgent;
    flow: CompiledFlowPlan;
    event: CustomAgentEvent;
    state: JsonObject;
    chatHistory: ChatMessage[];
    targetMessage?: MessageValue;
    signal: AbortSignal;
    random: RandomSource;
    ids: IdSource;
    onEffectsApplied?: (
      state: JsonObject,
      effects: readonly GraphNodeEffect[],
      generationResponse?: string,
    ) => Promise<void>;
  }): Promise<GraphExecutionResult>;
}

export type GraphLifecycleRunResult = {
  checkpoint: CustomAgentsCheckpoint;
  response?: string;
  createdMessages: string[];
  targetContent?: string;
  ran: string[];
  skipped: string[];
};

export type PreparedGenerationFlows = {
  checkpoint: CustomAgentsCheckpoint;
  eligible: EligibleTriggerFlow[];
  advancedFlowIds: Set<string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pathValue(root: unknown, path: string): JsonValue {
  let value = root;
  for (const segment of path.split('.')) {
    if (Array.isArray(value)) {
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index < 0 || index >= value.length)
        throw new Error(`Unresolved path ${path}`);
      value = value[index];
    } else if (isRecord(value) && Object.hasOwn(value, segment)) value = value[segment];
    else throw new Error(`Unresolved path ${path}`);
  }
  return clone(value as JsonValue);
}

function referenceValue(
  reference: EligibilityReference,
  namespaces: { event: CustomAgentEvent; config: JsonObject; state: JsonObject },
): JsonValue {
  const separator = reference.$ref.indexOf('.');
  const root = reference.$ref.slice(0, separator) as 'event' | 'config' | 'state';
  return pathValue(namespaces[root], reference.$ref.slice(separator + 1));
}

function isReference(value: EligibilityValue): value is EligibilityReference {
  return isRecord(value) && Object.hasOwn(value, '$ref');
}

function resolveEligibilityValue(
  value: EligibilityValue,
  namespaces: { event: CustomAgentEvent; config: JsonObject; state: JsonObject },
): JsonValue {
  if (isReference(value)) return referenceValue(value, namespaces);
  if (Array.isArray(value)) return value.map((item) => resolveEligibilityValue(item, namespaces));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveEligibilityValue(item, namespaces)]),
    );
  return value;
}

function deepEqual(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]!))
    );
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key] as JsonValue, right[key] as JsonValue))
    );
  }
  return false;
}

function evaluateEligibilityUnsafe(
  condition: EligibilityCondition,
  namespaces: { event: CustomAgentEvent; config: JsonObject; state: JsonObject },
): boolean {
  switch (condition.op) {
    case 'all':
      return condition.conditions.every((item) => evaluateEligibilityUnsafe(item, namespaces));
    case 'any':
      return condition.conditions.some((item) => evaluateEligibilityUnsafe(item, namespaces));
    case 'not':
      return !evaluateEligibilityUnsafe(condition.condition, namespaces);
    case 'exists':
    case 'missing': {
      let exists = true;
      try {
        referenceValue(condition.reference, namespaces);
      } catch {
        exists = false;
      }
      return condition.op === 'exists' ? exists : !exists;
    }
    case 'equals':
    case 'notEquals': {
      const equal = deepEqual(
        resolveEligibilityValue(condition.left, namespaces),
        resolveEligibilityValue(condition.right, namespaces),
      );
      return condition.op === 'equals' ? equal : !equal;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = resolveEligibilityValue(condition.left, namespaces);
      const right = resolveEligibilityValue(condition.right, namespaces);
      if (typeof left !== 'number' || typeof right !== 'number') throw new Error(`${condition.op} requires numbers`);
      if (condition.op === 'gt') return left > right;
      if (condition.op === 'gte') return left >= right;
      if (condition.op === 'lt') return left < right;
      return left <= right;
    }
    case 'in': {
      const collection = resolveEligibilityValue(condition.collection, namespaces);
      if (!Array.isArray(collection)) throw new Error('in requires an array collection');
      const value = resolveEligibilityValue(condition.value, namespaces);
      return collection.some((item) => deepEqual(value, item));
    }
  }
}

/** Eligibility is intentionally fail-closed and invokes no graph capability. */
export function evaluateTriggerEligibility(
  condition: EligibilityCondition | undefined,
  namespaces: { event: CustomAgentEvent; config: JsonObject; state: JsonObject },
): boolean {
  if (!condition) return true;
  try {
    return evaluateEligibilityUnsafe(condition, namespaces);
  } catch {
    return false;
  }
}

function declarationEvent(event: CustomAgentEvent): TriggerDeclaration['event'] {
  if (event.trigger === 'AFTER_USER_MESSAGE') return 'AFTER_USER';
  if (event.trigger === 'BEFORE_ASSISTANT_GENERATION') return 'BEFORE_GENERATION';
  if (event.trigger === 'ASSISTANT_GENERATION') return 'GENERATE_ASSISTANT';
  if (event.trigger === 'AFTER_ASSISTANT_MESSAGE') return 'AFTER_GENERATION';
  return 'MANUAL';
}

export function triggerMatchesEvent(declaration: Readonly<TriggerDeclaration>, event: CustomAgentEvent): boolean {
  if (declaration.event !== declarationEvent(event)) return false;
  return !('generationMode' in event) || declaration.generationModes.includes(event.generationMode);
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function orderTriggerFlows(
  agents: readonly CompiledGraphAgent[],
  event: CustomAgentEvent,
): EligibleTriggerFlow[] {
  return agents
    .filter((agent) => agent.definition.enabled && agent.plan.agent.enabled)
    .flatMap((agent) =>
      agent.plan.agent.flows.flatMap((flow) =>
        flow.kind === 'TRIGGER' && flow.trigger && triggerMatchesEvent(flow.trigger, event)
          ? [{ agent, flow, declaration: flow.trigger }]
          : [],
      ),
    )
    .sort(
      (left, right) =>
        right.agent.definition.priority - left.agent.definition.priority ||
        compareIds(left.agent.definition.id, right.agent.definition.id) ||
        compareIds(left.flow.id, right.flow.id),
    );
}

export function graphScheduleAllows(count: number, declaration: Readonly<TriggerDeclaration>): boolean {
  return declaration.schedule.type === 'ALWAYS' || count % declaration.schedule.interval === 0;
}

function targetFor(event: CustomAgentEvent): MessageValue | undefined {
  if ('targetMessage' in event) return event.targetMessage;
  if ('message' in event) return event.message;
  return undefined;
}

function applyInjectionEffect(
  injections: ActiveInjection[],
  effect: Extract<GraphNodeEffect, { type: 'INJECTION_SET' }>,
  flowId: string,
): void {
  const value: ActiveInjection = {
    id: effect.injectionId,
    flowId: flowId,
    content: effect.content,
    placement: effect.placement,
    depth: effect.depth,
    lifetime:
      effect.lifetime.type === 'FOR_N_GENERATIONS'
        ? { type: 'FOR_N_GENERATIONS', remaining: effect.lifetime.generations }
        : effect.lifetime,
    activation: effect.activation,
  };
  const index = injections.findIndex((item) => item.id === effect.injectionId);
  if (index < 0) injections.push(value);
  else injections[index] = value;
}

export class GraphTriggerLifecycle {
  public constructor(
    private readonly agents: () => readonly CompiledGraphAgent[],
    private readonly executor: GraphLifecycleExecutor,
    private readonly services: { random: RandomSource; ids: IdSource },
  ) {}

  public async prepareGenerationFlows(
    source: CustomAgentsCheckpoint,
    event: CustomAgentEvent,
    onCheckpoint?: (checkpoint: CustomAgentsCheckpoint) => Promise<void> | void,
  ): Promise<PreparedGenerationFlows> {
    const checkpoint = clone(assertValid(validateCheckpoint(source)));
    const eligible: EligibleTriggerFlow[] = [];
    const advancedFlowIds = new Set<string>();
    for (const candidate of orderTriggerFlows(this.agents(), event)) {
      const { agent, flow, declaration } = candidate;
      if (declaration.event !== 'GENERATE_ASSISTANT') continue;
      const persisted = ensureAgentCheckpoint(checkpoint, agent.definition);
      const stateValidation = validateSchemaValue(
        agent.definition.stateSchema,
        persisted.state,
        `checkpoint state for ${agent.definition.id}`,
      );
      if (!stateValidation.valid) throw new Error(stateValidation.errors.join('; '));
      const identity = `${agent.definition.id}/${flow.id}`;
      const count = (persisted.flowEventCounts[flow.id] ?? 0) + 1;
      persisted.flowEventCounts[flow.id] = count;
      advancedFlowIds.add(identity);
      if (
        graphScheduleAllows(count, declaration) &&
        evaluateTriggerEligibility(declaration.condition, {
          event,
          config: agent.definition.configurationDefaults,
          state: persisted.state,
        })
      )
        eligible.push(candidate);
    }
    await onCheckpoint?.(checkpoint);
    return { checkpoint, eligible, advancedFlowIds };
  }

  public async run(
    source: CustomAgentsCheckpoint,
    event: CustomAgentEvent,
    signal: AbortSignal,
    chatHistory: ChatMessage[],
    options: {
      flowIds?: Set<string>;
      assumeEligibleFlowIds?: Set<string>;
      alreadyAdvancedFlowIds?: Set<string>;
      targetMessage?: MessageValue;
      onCheckpoint?: (checkpoint: CustomAgentsCheckpoint) => Promise<void> | void;
      onVisibleMessage?: (effect: Extract<GraphNodeEffect, { type: 'VISIBLE_MESSAGE' }>) => Promise<void>;
    } = {},
  ): Promise<GraphLifecycleRunResult> {
    const checkpoint = clone(assertValid(validateCheckpoint(source)));
    const createdMessages: string[] = [];
    const ran: string[] = [];
    const skipped: string[] = [];
    let response: string | undefined;
    const target = options.targetMessage ?? targetFor(event);
    let targetContent = target?.content;

    for (const { agent, flow, declaration } of orderTriggerFlows(this.agents(), event)) {
      const identity = `${agent.definition.id}/${flow.id}`;
      if (options.flowIds && !options.flowIds.has(identity)) continue;
      signal.throwIfAborted();
      const persisted = ensureAgentCheckpoint(checkpoint, agent.definition);
      const alreadyAdvanced = options.alreadyAdvancedFlowIds?.has(identity) ?? false;
      const count = alreadyAdvanced
        ? (persisted.flowEventCounts[flow.id] ?? 0)
        : (persisted.flowEventCounts[flow.id] ?? 0) + 1;
      if (!alreadyAdvanced) {
        persisted.flowEventCounts[flow.id] = count;
        await options.onCheckpoint?.(checkpoint);
      }
      if (
        !options.assumeEligibleFlowIds?.has(identity) &&
        (!graphScheduleAllows(count, declaration) ||
          !evaluateTriggerEligibility(declaration.condition, {
            event,
            config: agent.definition.configurationDefaults,
            state: persisted.state,
          }))
      ) {
        skipped.push(identity);
        continue;
      }

      let appliedDuringExecution = false;
      const applyEffects = async (state: JsonObject, effects: readonly GraphNodeEffect[]): Promise<void> => {
        persisted.state = clone(state);
        for (const effect of effects) {
          if (effect.type === 'INJECTION_SET') applyInjectionEffect(persisted.injections, effect, flow.id);
          else if (effect.type === 'INJECTION_REMOVE')
            persisted.injections = persisted.injections.filter((item) => item.id !== effect.injectionId);
          else if (effect.type === 'VISIBLE_MESSAGE') {
            if (options.onVisibleMessage) await options.onVisibleMessage(effect);
            else if (effect.operation === 'CREATE') createdMessages.push(effect.content);
            else if (effect.operation === 'REPLACE_TARGET') targetContent = effect.content;
            else targetContent = `${targetContent ?? ''}${effect.content}`;
          }
          await options.onCheckpoint?.(checkpoint);
        }
      };
      const execution = await this.executor.execute({
        agent,
        flow,
        event,
        state: clone(persisted.state),
        chatHistory: clone(chatHistory),
        ...(target
          ? { targetMessage: { ...target, ...(targetContent === undefined ? {} : { content: targetContent }) } }
          : {}),
        signal,
        random: this.services.random,
        ids: this.services.ids,
        onEffectsApplied: async (state, effects) => {
          appliedDuringExecution = true;
          await applyEffects(state, effects);
        },
      });
      if (execution.status !== 'COMPLETED') {
        if (execution.status === 'CANCELLED') throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        throw new Error(execution.error);
      }
      const stateValidation = validateSchemaValue(
        agent.definition.stateSchema,
        execution.state,
        `final state for ${agent.definition.id}`,
      );
      if (!stateValidation.valid) throw new Error(stateValidation.errors.join('; '));
      if (!appliedDuringExecution) await applyEffects(execution.state, execution.effects);
      else persisted.state = clone(execution.state);
      if (execution.generationResponse !== undefined) {
        if (response !== undefined) throw new Error('Multiple generation responses were supplied');
        response = execution.generationResponse;
      }
      ran.push(identity);
    }

    assertValid(validateCheckpoint(checkpoint));
    return {
      checkpoint,
      ...(response === undefined ? {} : { response }),
      createdMessages,
      ...(targetContent === undefined ? {} : { targetContent }),
      ran,
      skipped,
    };
  }
}
