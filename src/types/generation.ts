import type { GenerationMode, OpenrouterMiddleoutType, ReasoningEffort } from '../constants';
import type { ApiModel, ApiProvider } from './api';
import type { Character } from './character';
import type { ChatMessage, ChatMetadata } from './chat';
import type { MessageRole } from './common';
import type { InstructTemplate } from './instruct';
import type { Persona } from './persona';
import type { ApiFormatter, Proxy, ReasoningTemplate, SamplerSettings, Settings } from './settings';
import type { Tokenizer } from './tokenizer';
import type { WorldInfoBook, WorldInfoEntry, WorldInfoSettings } from './world-info';

export { type MessageRole, type ReasoningEffort };

export interface ApiChatImage {
  url: string;
  detail?: 'auto' | 'low' | 'high';
}

export interface ApiChatContentPart {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url';
  text?: string;
  image_url?: ApiChatImage;
  video_url?: ApiChatImage;
  audio_url?: { url: string };
}

export interface ApiChatMessage {
  role: MessageRole;
  content: string | ApiChatContentPart[];
  name: string;
}

export type ChatCompletionPayload = Partial<{
  stream: boolean;
  // For chat
  messages: ApiChatMessage[];
  // For text
  prompt: string;

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
  reverse_proxy?: string;
  proxy_password?: string;

  // KoboldCpp Specific
  rep_pen?: number;
  rep_pen_range?: number;
  sampler_order?: number[];
  tfs?: number;
  typical?: number;
  use_default_badwordsids?: boolean;
  dynatemp_range?: number;
  smoothing_factor?: number;
  dynatemp_exponent?: number;
  mirostat?: number;
  mirostat_tau?: number;
  mirostat_eta?: number;
  grammar?: string;
  grammar_retain_state?: boolean;
  banned_tokens?: string[];
  dry_multiplier?: number;
  dry_base?: number;
  dry_allowed_length?: number;
  dry_penalty_last_n?: number;
  dry_sequence_breakers?: string[];
  xtc_threshold?: number;
  xtc_probability?: number;
  nsigma?: number;

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

  // Ollama-specific & Generic Options
  options?: Record<string, unknown>;
  ollama_server?: string;
  api_type?: string;
  api_server?: string;
  koboldcpp_server?: string;

  // Custom Provider
  custom_url?: string;
  custom_include_body?: string;
  custom_exclude_body?: string[];
  custom_include_headers?: Record<string, string>;

  // Azure
  azure_base_url?: string;
  azure_deployment_name?: string;
  azure_api_version?: string;

  // ZAI
  zai_endpoint?: string;

  // Vertex
  vertexai_auth_mode?: string;
  vertexai_region?: string;
  vertexai_express_project_id?: string;
}>;

export interface GenerationResponse {
  content: string;
  reasoning?: string;
  token_count?: number;
  images?: string[];
}

export interface StreamedChunk {
  delta: string;
  reasoning?: string; // Full reasoning
  images?: string[];
}

export type BuildChatCompletionPayloadOptions = {
  samplerSettings: SamplerSettings;
  messages: ApiChatMessage[];
  model: string;
  provider: ApiProvider;
  providerSpecific: Settings['api']['providerSpecific'];
  proxy?: Omit<Proxy, 'id' | 'name'>;
  playerName?: string;
  modelList?: ApiModel[];
  formatter?: ApiFormatter;
  instructTemplate?: InstructTemplate;
  reasoningTemplate?: ReasoningTemplate;
  activeCharacter?: Character;
};

export type GenerationContext = {
  generationId: string;
  mode: GenerationMode;
  characters: Character[];
  chatMetadata: ChatMetadata;
  history: ChatMessage[];
  persona: Persona;
  tokenizer: Tokenizer;
  settings: {
    sampler: SamplerSettings;
    provider: ApiProvider;
    model: string;
    providerSpecific: Settings['api']['providerSpecific'];
    formatter: ApiFormatter;
    instructTemplate?: InstructTemplate;
    reasoningTemplate?: ReasoningTemplate;
  };
  // Other relevant data available to the interceptor for read-only purposes or modification
  playerName: string;
} & { controller: AbortController };

export type PromptBuilderOptions = {
  generationId: string;
  characters: Character[];
  chatMetadata: ChatMetadata;
  chatHistory: ChatMessage[];
  worldInfo: WorldInfoSettings;
  books: WorldInfoBook[];
  samplerSettings: SamplerSettings;
  persona: Persona;
  tokenizer: Tokenizer;
};

export interface PromptTokenBreakdown {
  // System / Character / Persona
  systemTotal: number; // Total tokens in system message(s)
  description: number; // Estimated
  personality: number; // Estimated
  scenario: number; // Estimated
  examples: number; // Estimated
  persona: number; // Estimated
  worldInfo: number; // Estimated or Calculated

  // Conversation
  chatHistory: number;

  // Misc
  extensions: number;
  bias: number;

  // Totals
  promptTotal: number; // Grand total
  maxContext: number; // Context Limit
  padding: number; // Max context - max response tokens
}

export interface ItemizedPrompt {
  generationId: string;
  messageIndex: number; // Map to chat message index (the bot response)
  swipeId?: number;
  model: string;
  api: string;
  tokenizer: string;
  presetName: string;

  messages: ApiChatMessage[];
  breakdown: PromptTokenBreakdown;

  timestamp: number;

  worldInfoEntries: Record<string, WorldInfoEntry[]>;
}

export interface GenerationTrackingOptions {
  /**
   * Source of the generation request (e.g. 'core', 'extension:my-ext')
   */
  source: string;
  /**
   * Optional context identifier (e.g. character name)
   */
  context?: string;
  /**
   * The model used for generation.
   */
  model: string;
  /**
   * Calculated input tokens before generation.
   */
  inputTokens: number;
}

export interface GenerationOptions {
  signal?: AbortSignal;
  /**
   * Tokenizer instance to calculate output tokens for usage tracking.
   */
  tokenizer?: Tokenizer;
  /**
   * Configuration for automatic usage tracking events.
   * If provided, an 'llm:usage' event will be emitted upon completion.
   */
  tracking?: GenerationTrackingOptions;
  /**
   * Callback executed when generation finishes (successfully or aborted).
   * Provides stats about the generation.
   */
  onCompletion?: (data: { outputTokens: number; duration: number }) => void;
  /**
   * Reasoning template to use for parsing reasoning from the response.
   */
  reasoningTemplate?: ReasoningTemplate;
}
