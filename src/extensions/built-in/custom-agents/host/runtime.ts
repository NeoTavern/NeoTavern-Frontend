import type { PromptInjection } from '../../../../types';
import { compileGraphPreset } from '../graph/compile';
import type { GraphPreset, JsonObject } from '../graph/contracts';
import { builtinNodeRegistry } from '../registry/builtin-nodes';
import { executeGraphPlan, type GraphExecutionResult } from '../runtime/execute-plan';
import { genericToolCatalog } from '../registry/tools';
import { checkpointAtTip, CUSTOM_AGENTS_CHECKPOINT_KEY, ensureAgentCheckpoint } from './checkpoints';
import type { ActiveInjection } from './contracts';
import type { CustomAgentsHostAPI } from './api';
import type { RunDiagnostic } from '../runtime/diagnostics';
import type { CompiledGraphAgent, GraphLifecycleExecutor } from './lifecycle';
import { GraphHostLlmDispatcher, GraphHostTemplateRenderer, promptContextFromHost } from './prompt';
import { registerGraphCustomAgentsGeneration } from './generation';

export interface GraphSelectedAgentContext {
  state: JsonObject;
  config: JsonObject;
  injections: ActiveInjection[];
  selectionKey: string;
}

export interface GraphRunDiagnosticRecord {
  agentId: string;
  flowId: string;
  diagnostics: readonly Readonly<RunDiagnostic>[];
}

export interface GraphCustomAgentsRuntime extends GraphLifecycleExecutor {
  getAgents(): readonly CompiledGraphAgent[];
  getSelectedAgentContext(agentId: string): GraphSelectedAgentContext | undefined;
  getDiagnostics(agentId?: string): readonly GraphRunDiagnosticRecord[];
  clearDiagnostics(agentId?: string): void;
  subscribe(listener: () => void): () => void;
  invalidate(): void;
  setGenerationInjections(
    generationId: string,
    value: { injections: PromptInjection[]; acknowledge(ids: readonly string[]): void } | undefined,
  ): void;
  beginManual(agentId: string): AbortSignal;
  finishManual(agentId: string, signal: AbortSignal): void;
  abortManual(agentId: string): boolean;
  dispose(): void;
}

function compilationError(preset: GraphPreset, diagnostics: { code: string; message: string }[]): Error {
  return new Error(
    `Custom Agent graph ${preset.agent.id} failed compilation: ${diagnostics
      .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
      .join('; ')}`,
  );
}

export function compileGraphAgents(presets: readonly GraphPreset[]): readonly CompiledGraphAgent[] {
  const ids = new Set<string>();
  return presets.map((preset) => {
    if (ids.has(preset.agent.id)) throw new Error(`Duplicate Custom Agent graph ID ${preset.agent.id}`);
    ids.add(preset.agent.id);
    const result = compileGraphPreset(preset, builtinNodeRegistry);
    if (!result.success) throw compilationError(preset, result.diagnostics);
    return Object.freeze({ definition: structuredClone(preset.agent), plan: result.plan });
  });
}

export function createGraphCustomAgentsRuntime(
  api: CustomAgentsHostAPI,
  getPresets: () => readonly GraphPreset[],
): GraphCustomAgentsRuntime {
  const generationInjections = new Map<
    string,
    { injections: PromptInjection[]; acknowledge(ids: readonly string[]): void }
  >();
  const llm = new GraphHostLlmDispatcher(api, (generationId) => generationInjections.get(generationId));
  const templates = new GraphHostTemplateRenderer(api);
  const manuals = new Map<string, AbortController>();
  const diagnostics = new Map<string, GraphRunDiagnosticRecord>();
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((listener) => listener());
  const unsubscribers: Array<() => void> = [];
  const cleanupSubscriptions = (): unknown[] => {
    const errors: unknown[] = [];
    while (unsubscribers.length > 0) {
      try {
        unsubscribers.pop()!();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  };
  const eventNames = [
    'chat:entered',
    'chat:cleared',
    'message:created',
    'message:updated',
    'message:deleted',
    'message:swipe-changed',
    'message:swipe-deleted',
    'generation:finished',
  ] as const;
  try {
    for (const event of eventNames) unsubscribers.push(api.events.on(event, notify as never));
  } catch (error) {
    const cleanupErrors = cleanupSubscriptions();
    if (cleanupErrors.length > 0)
      throw new AggregateError([error, ...cleanupErrors], 'Graph Custom Agents runtime creation failed during cleanup');
    throw error;
  }
  let executableSignature: string | undefined;
  let agents: readonly CompiledGraphAgent[] = [];
  const resolveAgents = (): readonly CompiledGraphAgent[] => {
    const current = getPresets();
    const signature = JSON.stringify(current);
    if (signature !== executableSignature) {
      agents = compileGraphAgents(current);
      executableSignature = signature;
    }
    return agents;
  };

  return {
    getAgents: resolveAgents,
    execute: async (request): Promise<GraphExecutionResult> => {
      const key = `${request.agent.definition.id}/${request.flow.id}`;
      const result = await executeGraphPlan({
        plan: request.agent.plan,
        flowId: request.flow.id,
        event: request.event,
        configuration: structuredClone(request.agent.definition.configurationDefaults),
        state: structuredClone(request.state),
        signal: request.signal,
        random: request.random,
        ids: request.ids,
        tools: genericToolCatalog,
        llm,
        templates,
        promptContext: promptContextFromHost(api, request.chatHistory, request.targetMessage),
        onEffectsApplied: request.onEffectsApplied,
        onDiagnostics: (snapshot) => {
          diagnostics.set(key, {
            agentId: request.agent.definition.id,
            flowId: request.flow.id,
            diagnostics: snapshot,
          });
          notify();
        },
      });
      diagnostics.set(key, {
        agentId: request.agent.definition.id,
        flowId: request.flow.id,
        diagnostics: result.diagnostics,
      });
      notify();
      return result;
    },
    getSelectedAgentContext: (agentId) => {
      const agent = resolveAgents().find((candidate) => candidate.definition.id === agentId)?.definition;
      if (!agent) throw new Error(`Unknown agent ${agentId}`);
      const chatInfo = api.chat.getChatInfo();
      if (!chatInfo) return undefined;
      const messages = api.chat.getHistory();
      const checkpoint = api.chat.getChatExtensionData(CUSTOM_AGENTS_CHECKPOINT_KEY);
      const selected = ensureAgentCheckpoint(
        checkpointAtTip(messages, {
          integrity: chatInfo.chat_metadata.integrity,
          ...(checkpoint === undefined ? {} : { extra: { [CUSTOM_AGENTS_CHECKPOINT_KEY]: checkpoint } }),
        }),
        agent,
      );
      return {
        state: structuredClone(selected.state),
        config: structuredClone(agent.configurationDefaults),
        injections: structuredClone(selected.injections),
        selectionKey: JSON.stringify([
          chatInfo.file_id,
          messages.map((message) => [message.swipe_id ?? 0, message.swipes[message.swipe_id ?? 0] ?? message.mes]),
          selected.state,
          agent.configurationDefaults,
        ]),
      };
    },
    getDiagnostics: (agentId) =>
      [...diagnostics.values()]
        .filter((record) => agentId === undefined || record.agentId === agentId)
        .map((record) => structuredClone(record)),
    clearDiagnostics: (agentId) => {
      for (const [key, record] of diagnostics)
        if (agentId === undefined || record.agentId === agentId) diagnostics.delete(key);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate: notify,
    setGenerationInjections: (generationId, value) => {
      if (value) generationInjections.set(generationId, value);
      else generationInjections.delete(generationId);
    },
    beginManual: (agentId) => {
      if (manuals.has(agentId)) throw new Error(`Agent ${agentId} already has an active manual flow`);
      const controller = new AbortController();
      manuals.set(agentId, controller);
      return controller.signal;
    },
    finishManual: (agentId, signal) => {
      if (manuals.get(agentId)?.signal === signal) manuals.delete(agentId);
    },
    abortManual: (agentId) => {
      const controller = manuals.get(agentId);
      if (!controller) return false;
      controller.abort(new DOMException('Manual flow aborted', 'AbortError'));
      return true;
    },
    dispose: () => {
      for (const controller of manuals.values())
        controller.abort(new DOMException('Extension deactivated', 'AbortError'));
      manuals.clear();
      generationInjections.clear();
      diagnostics.clear();
      listeners.clear();
      const cleanupErrors = cleanupSubscriptions();
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      if (cleanupErrors.length > 1)
        throw new AggregateError(cleanupErrors, 'Failed to dispose Graph Custom Agents runtime');
    },
  };
}

export function activateGraphCustomAgentsHost(
  api: CustomAgentsHostAPI,
  getPresets: () => readonly GraphPreset[],
  options: { random?: () => number } = {},
): { runtime: GraphCustomAgentsRuntime; dispose(): void } {
  const runtime = createGraphCustomAgentsRuntime(api, getPresets);
  let unregister: (() => void) | undefined;
  try {
    // Compile before registering observers so an invalid definition cannot leave a partial activation.
    runtime.getAgents();
    unregister = registerGraphCustomAgentsGeneration(api, runtime, options);
  } catch (error) {
    runtime.dispose();
    throw error;
  }
  let active = true;
  return {
    runtime,
    dispose() {
      if (!active) return;
      active = false;
      const errors: unknown[] = [];
      try {
        unregister?.();
      } catch (error) {
        errors.push(error);
      }
      try {
        runtime.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Failed to dispose graph Custom Agents host');
    },
  };
}
