import type { CompiledPresetPlan } from '../graph/plan-types';
import type { JsonObject, JsonValue } from '../graph/contracts';
import type {
  GraphNodeEffect,
  GraphPromptContext,
  IdSource,
  LlmDispatcher,
  RandomSource,
  TemplateRenderer,
  ToolDispatcher,
} from '../registry/node-definition';
import type { CustomAgentEvent } from '../host/contracts';
import { BoundedRunDiagnostics, type DiagnosticsObserver } from './diagnostics';
import { GraphEffectState } from './effects';

export type GraphExecutionRequest = {
  plan: CompiledPresetPlan;
  flowId: string;
  event: CustomAgentEvent;
  configuration: JsonObject;
  state: JsonObject;
  signal: AbortSignal;
  random: RandomSource;
  ids: IdSource;
  tools: ToolDispatcher;
  llm: LlmDispatcher;
  templates: TemplateRenderer;
  promptContext: GraphPromptContext;
  onEffectsApplied?: (
    state: JsonObject,
    effects: readonly GraphNodeEffect[],
    generationResponse?: string,
  ) => Promise<void>;
  onDiagnostics?: DiagnosticsObserver;
};

export type IterationBinding = Readonly<{ item: JsonValue; index: number; accumulator?: JsonValue }>;

export type ScopeNodeState = {
  status: 'EXECUTING' | 'EXECUTED';
  outputs: Readonly<Record<string, JsonValue>>;
};

export type ScopeRuntimeContext = {
  flowId: string;
  scopeInvocationId: string;
  nodes: Map<string, ScopeNodeState>;
  mergeArrivals: Map<string, Set<string>>;
  bindings: Readonly<Record<string, JsonValue>>;
  iteration?: IterationBinding;
};

export function immutableClone<Value>(value: Value): Readonly<Value> {
  const clone = structuredClone(value);
  const freeze = (item: unknown, seen = new WeakSet<object>()): void => {
    if (item === null || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    for (const child of Object.values(item)) freeze(child, seen);
    Object.freeze(item);
  };
  freeze(clone);
  return clone;
}

export class InvocationExecutionContext {
  readonly request: GraphExecutionRequest;
  readonly event: Readonly<CustomAgentEvent>;
  readonly configuration: Readonly<JsonObject>;
  readonly promptContext: Readonly<GraphPromptContext>;
  readonly diagnostics: BoundedRunDiagnostics;
  readonly effectState: GraphEffectState;
  readonly #scopeOrdinals = new Map<string, number>();

  constructor(request: GraphExecutionRequest) {
    this.request = request;
    this.event = immutableClone(request.event);
    this.configuration = immutableClone(request.configuration);
    this.promptContext = immutableClone(request.promptContext);
    this.diagnostics = new BoundedRunDiagnostics(request.onDiagnostics);
    this.effectState = new GraphEffectState(request.state, request.plan.agent.stateSchema);
  }

  cancellation(): void {
    this.request.signal.throwIfAborted();
  }

  createScope(flowId: string, bindings: Record<string, JsonValue>, iteration?: IterationBinding): ScopeRuntimeContext {
    const ordinal = (this.#scopeOrdinals.get(flowId) ?? 0) + 1;
    this.#scopeOrdinals.set(flowId, ordinal);
    return {
      flowId,
      scopeInvocationId: `${flowId}:${ordinal}`,
      nodes: new Map(),
      mergeArrivals: new Map(),
      bindings: immutableClone(bindings),
      ...(iteration ? { iteration: immutableClone(iteration) } : {}),
    };
  }
}
