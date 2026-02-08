import type {
  CustomPromptPostProcessing,
  GenerationMode,
  OpenrouterMiddleoutType,
  ReasoningEffort,
} from '../constants';
import type { ApiModel, ApiProvider } from './api';
import type { Character } from './character';
import type { ChatMessage, ChatMetadata } from './chat';
import type { MessageRole } from './common';
import type { InstructTemplate } from './instruct';
import type { Persona } from './persona';
import type { ApiFormatter, Proxy, ReasoningTemplate, SamplerSettings, Settings } from './settings';
import type { Tokenizer } from './tokenizer';
import type { ToolDefinition, ToolInvocation } from './tools';
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

export interface ApiChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
  signature?: string;
}

/**
 * Represents a piece of a tool call as it is being streamed.
 * Fields are optional and are merged to form a complete ApiChatToolCall.
 */
export type ApiChatToolCallDelta = {
  index: number; // The index of the tool call in the list
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
  signature?: string;
};

// Base interface for all message types
interface ApiMessageBase {
  name: string;
}

// Specific message types for the discriminated union
export interface ApiSystemMessage extends ApiMessageBase {
  role: 'system';
  content: string;
}

export interface ApiUserMessage extends ApiMessageBase {
  role: 'user';
  content: string | ApiChatContentPart[];
}

export type ApiAssistantMessage = ApiMessageBase & {
  role: 'assistant';
} & (
    | {
        content: string | ApiChatContentPart[];
        tool_calls?: ApiChatToolCall[];
      }
    | {
        content: null;
        tool_calls: ApiChatToolCall[];
      }
  );

export interface ApiToolMessage extends ApiMessageBase {
  role: 'tool';
  content: string;
  tool_call_id: string;
}

export type ApiChatMessage = ApiSystemMessage | ApiUserMessage | ApiAssistantMessage | ApiToolMessage;

export interface StructuredResponseSchema {
  name: string;
  strict: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any; // This is the JSON Schema object
}

// A base for structured response options
interface StructuredResponseBase {
  schema: StructuredResponseSchema;
}

// Options for when the provider natively supports JSON schema
interface StructuredResponseNative extends StructuredResponseBase {
  format?: 'native';
}

// Options for forcing JSON or XML output via prompting
export interface StructuredResponsePrompted extends StructuredResponseBase {
  format: 'json' | 'xml';
  jsonPrompt?: string; // Template for JSON prompt. Defaults to a system-wide one.
  xmlPrompt?: string; // Template for XML prompt. Defaults to a system-wide one.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exampleResponse?: any | boolean; // Example to include in prompt. `true` means auto-generate from schema. Defaults to `true`.
}

export type StructuredResponseOptions = StructuredResponseNative | StructuredResponsePrompted;

export interface ApiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters?: any;
  };
}

export interface ToolGenerationConfig {
  /**
   * Whether to include tools registered in the global ToolStore.
   * Defaults to true.
   */
  includeRegisteredTools?: boolean;
  /**
   * Additional tool definitions to include for this specific generation.
   */
  additionalTools?: ToolDefinition[];
  /**
   * Names of tools to exclude from the generation.
   */
  excludeTools?: string[];
  /**
   * Tool choice preference.
   */
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  /**
   * Whether to bypass the global tools enabled setting.
   */
  bypassGlobalCheck?: boolean;
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
  logit_bias?: Record<string, number>;
  logprobs?: boolean;
  top_logprobs?: number;
  n?: number;
  include_reasoning?: boolean;
  seed?: number;
  max_completion_tokens?: number;
  reasoning_effort?: ReasoningEffort | string;
  reverse_proxy?: string;
  proxy_password?: string;
  json_schema?: StructuredResponseSchema;

  // Tools
  tools?: ApiToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };

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
  structured_content?: object;
  tool_calls?: ApiChatToolCall[];
}

export interface StreamedChunk {
  delta: string;
  reasoning?: string; // Full reasoning
  images?: string[];
  tool_calls?: ApiChatToolCall[];
}

export type BuildChatCompletionPayloadOptions = {
  samplerSettings: SamplerSettings;
  messages: ApiChatMessage[];
  model: string;
  provider: ApiProvider;
  providerSpecific: Settings['api']['providerSpecific'];
  customPromptPostProcessing: CustomPromptPostProcessing;
  proxy?: Omit<Proxy, 'id' | 'name'>;
  playerName?: string;
  modelList?: ApiModel[];
  formatter?: ApiFormatter;
  instructTemplate?: InstructTemplate;
  activeCharacter?: Character;
  structuredResponse?: StructuredResponseOptions;
  toolConfig?: ToolGenerationConfig;
  mode?: GenerationMode;
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
  structuredResponse?: StructuredResponseOptions;
} & { controller: AbortController };

export type PromptBuilderOptions = {
  generationId: string;
  characters: Character[];
  chatMetadata?: ChatMetadata;
  chatHistory: ChatMessage[] | ApiChatMessage[];
  worldInfo: WorldInfoSettings;
  books: WorldInfoBook[];
  samplerSettings: SamplerSettings;
  persona: Persona;
  tokenizer: Tokenizer;
  mediaContext: MediaHydrationContext;
  structuredResponse?: StructuredResponseOptions;
};

export interface MediaHydrationContext {
  apiSettings: {
    sendMedia: boolean;
    imageQuality: 'low' | 'high' | 'auto';
    forbidExternalMedia: boolean;
  };
  modelCapabilities: {
    vision: boolean;
    video: boolean;
    audio: boolean;
  };
  formatter: string;
}

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
  toolInvocations?: ToolInvocation[];
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
  onCompletion?: (data: {
    outputTokens: number;
    duration: number;
    structured_content?: object;
    parse_error?: Error;
  }) => void;
  /**
   * Reasoning template to use for parsing reasoning from the response.
   */
  reasoningTemplate?: ReasoningTemplate;
  /**
   * Configuration for structured response generation.
   * If provided, the generation will be guided to produce a structured output (e.g., JSON, XML).
   */
  structuredResponse?: StructuredResponseOptions;
  /**
   * Configuration for tool calling.
   * If provided, tools will be included in the generation request.
   */
  toolConfig?: ToolGenerationConfig;
  /**
   * Whether this is a continuation or prefill scenario.
   * If true, leading whitespace will be preserved on the first chunk.
   */
  isContinuation?: boolean;
}
