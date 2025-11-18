import type { GenerationMode, OpenrouterMiddleoutType, ReasoningEffort } from '../constants';
import type { ApiModel, ChatCompletionSource } from './api';
import type { Character } from './character';
import type { ChatMessage } from './chat';
import type { MessageRole } from './common';
import type { Persona } from './persona';
import type { SamplerSettings, Settings } from './settings';
import type { Tokenizer } from './tokenizer';

export { type ReasoningEffort, type MessageRole };

export interface ApiChatMessage {
  role: MessageRole;
  content: string;
}

export type ChatCompletionPayload = Partial<{
  stream: boolean;
  messages: ApiChatMessage[];
  model: string;
  chat_completion_source: string;
  max_tokens: number;
  temperature?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  top_p?: number;
  top_k?: number;
  top_a?: number;
  min_p?: number;
  stop?: string[];
  // TODO: logit_bias?: Record<string, number>;
  n?: number;
  include_reasoning?: boolean;
  seed?: number;
  max_completion_tokens?: number;
  reasoning_effort?: ReasoningEffort | string;

  // Claude-specific
  claude_use_sysprompt: boolean;
  assistant_prefill: string;

  // OpenRouter-specific
  use_fallback?: boolean;
  provider?: string[];
  allow_fallbacks?: boolean;
  middleout?: OpenrouterMiddleoutType;

  // Google-specific
  use_makersuite_sysprompt?: boolean;

  // Mistral-specific
  safe_prompt?: boolean;
}>;

export interface GenerationResponse {
  content: string;
  reasoning?: string;
}

export interface StreamedChunk {
  delta: string;
  reasoning?: string; // Full reasoning
}

export type BuildChatCompletionPayloadOptions = {
  samplerSettings: SamplerSettings;
  messages: ApiChatMessage[];
  model: string;
  source: ChatCompletionSource;
  providerSpecific: Settings['api']['provider_specific'];
  playerName?: string;
  characterName?: string;
  modelList?: ApiModel[];
};

export type GenerationContext = {
  mode: GenerationMode;
  character: Character;
  history: ChatMessage[];
  persona: Persona;
  tokenizer: Tokenizer;
  settings: {
    sampler: SamplerSettings;
    source: ChatCompletionSource;
    model: string;
    providerSpecific: Settings['api']['provider_specific'];
  };
  // Other relevant data available to the interceptor for read-only purposes or modification
  playerName: string;
  characterName: string;
} & { controller: AbortController };

export type PromptBuilderOptions = {
  character: Character;
  chatHistory: ChatMessage[];
  samplerSettings: SamplerSettings;
  persona: Persona;
  tokenizer: Tokenizer;
};
