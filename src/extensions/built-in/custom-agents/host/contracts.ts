import type { JsonObject, JsonValue } from '../generic/json';

export type InjectionLifetime =
  | { type: 'ONCE' }
  | { type: 'UNTIL_REMOVED' }
  | { type: 'FOR_N_GENERATIONS'; generations: number };

export interface ActiveInjection {
  id: string;
  flowId: string;
  content: string;
  placement: 'relative' | 'in-chat';
  depth: number;
  lifetime: { type: 'ONCE' } | { type: 'UNTIL_REMOVED' } | { type: 'FOR_N_GENERATIONS'; remaining: number };
  activation: { type: 'ALWAYS' } | { type: 'PROBABILITY'; probability: number };
}

export interface AgentCheckpoint {
  state: JsonObject;
  injections: ActiveInjection[];
  flowEventCounts: Record<string, number>;
}

export interface CustomAgentsCheckpoint {
  agents: Record<string, AgentCheckpoint>;
}

export interface MessageValue {
  index: number;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  name: string;
  content: string;
  swipeIndex?: number;
}

export type GenerationMode = 'NEW' | 'REGENERATE' | 'ADD_SWIPE';

export type CustomAgentEvent =
  | { trigger: 'AFTER_USER_MESSAGE'; message: MessageValue }
  | {
      trigger: 'BEFORE_ASSISTANT_GENERATION' | 'ASSISTANT_GENERATION';
      generationId: string;
      generationMode: GenerationMode;
      targetMessage?: MessageValue;
    }
  | { trigger: 'AFTER_ASSISTANT_MESSAGE'; generationId: string; generationMode: GenerationMode; message: MessageValue }
  | { trigger: 'MANUAL'; input: JsonValue };
