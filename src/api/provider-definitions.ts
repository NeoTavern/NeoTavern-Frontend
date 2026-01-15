import YAML from 'yaml';
import { ReasoningEffort } from '../constants';
import type {
  ApiChatToolCall,
  ApiChatToolCallDelta,
  ApiModel,
  ApiProvider,
  ChatCompletionPayload,
  ModelCapability,
  StreamedChunk,
} from '../types';
import { api_providers } from '../types';
import type { ApiUserMessage, BuildChatCompletionPayloadOptions } from '../types/generation';
import type { ApiFormatter, SamplerSettings } from '../types/settings';
import { isDataURL } from '../utils/media';

/**
 * Defines how a setting maps to an API payload parameter.
 */
export interface ParamHandling {
  /**
   * The key to use in the final API payload.
   * If omitted, uses the key from SamplerSettings.
   */
  remoteKey?: keyof ChatCompletionPayload | string;

  /**
   * If defined, the value will be clamped to this minimum.
   */
  min?: number;

  /**
   * If defined, the value will be clamped to this maximum.
   */
  max?: number;

  /**
   * Optional transform function to modify the value before sending.
   * Useful for slicing arrays (stop sequences) or type conversion.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform?: (value: any, context: BuildChatCompletionPayloadOptions) => any;
}

/**
 * Configuration for a specific parameter.
 */
export interface ParamConfiguration {
  /**
   * Default handling for this parameter.
   * This defines shared behavior (like checking for valid seeds, or clamping).
   */
  defaults?: ParamHandling;

  /**
   * Per-provider overrides.
   *
   * A parameter is ONLY sent if the provider is present in this map (with a value or empty object).
   * If the value is `null`, it is explicitly disabled.
   */
  providers?: Partial<Record<string, ParamHandling | null>>;

  /**
   * Model-specific overrides.
   * These take precedence over provider overrides.
   */
  modelRules?: Array<{
    pattern: RegExp;
    rule: ParamHandling | null;
  }>;

  /**
   * Formatter-specific overrides.
   * These take precedence over provider overrides.
   */
  formatterRules?: Array<{
    formatter: ApiFormatter[];
    providers?: ApiProvider[];
    rule: ParamHandling | null;
  }>;
}

/**
 * Function to inject custom logic into the payload.
 */
export type InjectionFunction = (
  payload: ChatCompletionPayload & Record<string, unknown>,
  context: BuildChatCompletionPayloadOptions,
) => void;

/**
 * Global model rule for logic that cannot be handled by simple parameter mapping.
 */
export interface ModelInjection {
  pattern: RegExp;
  inject: InjectionFunction;
}

/**
 * Configuration for provider-specific behaviors, like endpoint overrides.
 */
export interface ProviderConfig {
  textCompletionEndpoint?: string;
}

/**
 * Handlers for processing API responses.
 */
export interface ProviderResponseHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractMessage: (data: any) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractReasoning?: (data: any) => string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractImages?: (data: any) => string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractToolCalls?: (data: any) => ApiChatToolCall[];
  getStreamingReply: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    formatter?: ApiFormatter,
  ) => Omit<StreamedChunk, 'tool_calls'> & { tool_call_deltas?: ApiChatToolCallDelta[] };
}

// --- Capability Definitions ---

export interface ProviderCapability {
  supportsChat: boolean;
  supportsText: boolean;
}

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapability> = {
  [api_providers.OPENROUTER]: { supportsChat: true, supportsText: true },
  [api_providers.OPENAI]: { supportsChat: true, supportsText: false },
  [api_providers.CLAUDE]: { supportsChat: true, supportsText: false },
  [api_providers.AI21]: { supportsChat: true, supportsText: false },
  [api_providers.MAKERSUITE]: { supportsChat: true, supportsText: false },
  [api_providers.VERTEXAI]: { supportsChat: true, supportsText: false },
  [api_providers.MISTRALAI]: { supportsChat: true, supportsText: false },
  [api_providers.CUSTOM]: { supportsChat: true, supportsText: false },
  [api_providers.COHERE]: { supportsChat: true, supportsText: false },
  [api_providers.PERPLEXITY]: { supportsChat: true, supportsText: false },
  [api_providers.GROQ]: { supportsChat: true, supportsText: false },
  [api_providers.ELECTRONHUB]: { supportsChat: true, supportsText: false },
  [api_providers.NANOGPT]: { supportsChat: true, supportsText: false },
  [api_providers.DEEPSEEK]: { supportsChat: true, supportsText: false },
  [api_providers.AIMLAPI]: { supportsChat: true, supportsText: false },
  [api_providers.XAI]: { supportsChat: true, supportsText: false },
  [api_providers.POLLINATIONS]: { supportsChat: true, supportsText: false },
  [api_providers.MOONSHOT]: { supportsChat: true, supportsText: false },
  [api_providers.FIREWORKS]: { supportsChat: true, supportsText: false },
  [api_providers.COMETAPI]: { supportsChat: true, supportsText: false },
  [api_providers.AZURE_OPENAI]: { supportsChat: true, supportsText: false },
  [api_providers.ZAI]: { supportsChat: true, supportsText: false },
  [api_providers.KOBOLDCPP]: { supportsChat: true, supportsText: true },
  [api_providers.OLLAMA]: { supportsChat: true, supportsText: true },
};

export const PROVIDER_CONFIG: Partial<Record<ApiProvider, ProviderConfig>> = {
  [api_providers.OLLAMA]: { textCompletionEndpoint: '/api/backends/text-completions/generate' },
  [api_providers.KOBOLDCPP]: { textCompletionEndpoint: '/api/backends/text-completions/generate' },
};

// --- Media Support Definitions ---

const visionSupportedModels = [
  // OpenAI
  'chatgpt-4o-latest',
  'gpt-4-turbo',
  'gpt-4-vision',
  'gpt-4.1',
  'gpt-4.5-preview',
  'gpt-4o',
  'gpt-5',
  'o1',
  'o3',
  'o4-mini',
  // Claude
  'claude-3',
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-haiku-4',
  // Cohere
  'c4ai-aya-vision',
  'command-a-vision',
  // Google AI Studio / Vertex
  'gemini-2.0',
  'gemini-2.5',
  'gemini-3',
  'gemini-exp-1206',
  'learnlm',
  'gemini-robotics',
  // MistralAI
  'mistral-small-2503',
  'mistral-small-2506',
  'mistral-small-latest',
  'mistral-medium-latest',
  'mistral-medium-2505',
  'mistral-medium-2508',
  'pixtral',
  // xAI (Grok)
  'grok-4',
  'grok-2-vision',
  // Moonshot
  'moonshot-v1-8k-vision-preview',
  'moonshot-v1-32k-vision-preview',
  'moonshot-v1-128k-vision-preview',
  // Z.AI (GLM)
  'glm-4.5v',
  'glm-4.6v',
  'autoglm-phone',
];

const visionUnsupportedModels = ['gpt-4-turbo-preview', 'o1-mini', 'o3-mini'];

const videoSupportedModels = [
  // Gemini
  'gemini-2.0',
  'gemini-2.5',
  'gemini-exp-1206',
  'gemini-3',
  // Z.AI (GLM)
  'glm-4.5v',
  'glm-4.6v',
];

const audioSupportedModels = [
  // OpenAI
  'gpt-4o-audio',
  'gpt-4o-realtime',
  'gpt-4o-mini-audio',
  'gpt-4o-mini-realtime',
  'gpt-audio',
  'gpt-realtime',
  // Gemini
  'gemini-2.0',
  'gemini-2.5',
  'gemini-3',
  'gemini-exp-1206',
];

export interface ModelCapabilities {
  vision: boolean;
  video: boolean;
  audio: boolean;
  tools: boolean;
}

export function getModelCapabilities(
  provider: ApiProvider,
  modelId: string,
  modelList?: ApiModel[],
): ModelCapabilities {
  const capabilities: ModelCapabilities = {
    vision: false,
    video: false,
    audio: false,
    tools: false,
  };

  if (!modelId) return capabilities;

  const currentModel = modelList?.find((m) => m.id === modelId);

  // Vision Capability
  switch (provider) {
    case api_providers.OPENAI:
    case api_providers.AZURE_OPENAI:
      capabilities.vision =
        visionSupportedModels.some((m) => modelId.includes(m)) &&
        !visionUnsupportedModels.some((m) => modelId.includes(m));
      break;
    case api_providers.MAKERSUITE:
    case api_providers.VERTEXAI:
    case api_providers.CLAUDE:
    case api_providers.COHERE:
    case api_providers.XAI:
    case api_providers.MOONSHOT:
    case api_providers.ZAI:
      capabilities.vision = visionSupportedModels.some((m) => modelId.includes(m));
      break;
    case api_providers.OPENROUTER:
      capabilities.vision = !!currentModel?.architecture?.input_modalities?.includes('image');
      break;
    case api_providers.MISTRALAI:
      capabilities.vision = !!currentModel?.capabilities?.vision;
      break;
    case api_providers.AIMLAPI:
      capabilities.vision = !!currentModel?.features?.includes('openai/chat-completion.vision');
      break;
    case api_providers.ELECTRONHUB:
      capabilities.vision = !!currentModel?.metadata?.vision;
      break;
    case api_providers.POLLINATIONS:
      capabilities.vision = !!currentModel?.vision;
      break;
    case api_providers.NANOGPT:
      capabilities.vision = !!currentModel?.capabilities?.vision;
      break;
    case api_providers.CUSTOM:
    case api_providers.COMETAPI:
      capabilities.vision = true;
      break;
  }

  // Video Capability
  switch (provider) {
    case api_providers.MAKERSUITE:
    case api_providers.VERTEXAI:
    case api_providers.ZAI:
      capabilities.video = videoSupportedModels.some((m) => modelId.includes(m));
      break;
    case api_providers.OPENROUTER:
      capabilities.video = !!currentModel?.architecture?.input_modalities?.includes('video');
      break;
  }

  // Audio Capability
  switch (provider) {
    case api_providers.OPENAI:
    case api_providers.MAKERSUITE:
    case api_providers.VERTEXAI:
      capabilities.audio = audioSupportedModels.some((m) => modelId.includes(m));
      break;
    case api_providers.OPENROUTER:
      capabilities.audio = !!currentModel?.architecture?.input_modalities?.includes('audio');
      break;
    case api_providers.CUSTOM:
      capabilities.audio = true;
      break;
  }

  // Tools Capability
  if (currentModel) {
    switch (provider) {
      case api_providers.POLLINATIONS:
        capabilities.tools = !!currentModel.tools;
        break;
      case api_providers.FIREWORKS:
        capabilities.tools = !!currentModel.supports_tools;
        break;
      case api_providers.OPENROUTER:
        capabilities.tools = !!currentModel.supported_parameters?.includes('tools');
        break;
      case api_providers.MISTRALAI:
        capabilities.tools = !!currentModel.capabilities?.function_calling;
        break;
      case api_providers.AIMLAPI:
        capabilities.tools = !!currentModel.features?.includes('openai/chat-completion.function');
        break;
      case api_providers.ELECTRONHUB:
        capabilities.tools = !!currentModel.metadata?.function_call;
        break;
    }
  }

  // Fallback for tools if not determined by model list metadata
  if (!capabilities.tools) {
    const supportedSources: ApiProvider[] = [
      api_providers.OPENAI,
      api_providers.CUSTOM,
      api_providers.MISTRALAI,
      api_providers.CLAUDE,
      api_providers.OPENROUTER,
      api_providers.AIMLAPI,
      api_providers.GROQ,
      api_providers.COHERE,
      api_providers.DEEPSEEK,
      api_providers.MAKERSUITE,
      api_providers.VERTEXAI,
      api_providers.AI21,
      api_providers.XAI,
      api_providers.POLLINATIONS,
      api_providers.MOONSHOT,
      api_providers.FIREWORKS,
      api_providers.COMETAPI,
      api_providers.ELECTRONHUB,
      api_providers.AZURE_OPENAI,
      api_providers.ZAI,
      api_providers.NANOGPT,
    ];
    capabilities.tools = supportedSources.includes(provider);
  }

  return capabilities;
}

export function isCapabilitySupported(
  capability: ModelCapability,
  provider: ApiProvider,
  modelId: string,
  modelList?: ApiModel[],
): boolean {
  return getModelCapabilities(provider, modelId, modelList)[capability];
}

// --- Response Handlers ---

/**
 * Robust generic message extractor mimicking SillyTavern's extraction logic.
 * Used as a fallback and for default providers (OpenAI etc).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractMessageGeneric(data: any): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processContent = (content: any): string => {
    if (Array.isArray(content)) {
      return (
        content
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((x: any) => (typeof x === 'string' ? x : x?.text))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((x: any) => x)
          .join('')
      );
    }
    return typeof content === 'string' ? content : '';
  };

  const candidate =
    data?.choices?.[0]?.message?.content ?? // OpenAI / Standard
    data?.choices?.[0]?.text ?? // Text Completion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?.content?.find?.((p: any) => p.type === 'text')?.text ?? // Claude / OpenAI Vision
    data?.results?.[0]?.text ?? // Kobold
    data?.results?.[0]?.output?.text ?? // Legacy
    data?.text ?? // KoboldHorde / Simple
    data?.output ?? // NovelAI
    data?.response ?? // Ollama
    data?.content ?? // TextGenWebUI
    data?.[0]?.content ??
    data?.message?.content?.[0]?.text ??
    data?.message?.tool_plan ?? // Cohere
    '';

  const processed = processContent(candidate);
  return processed;
}

// Tool Extraction Utilities

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractToolsGeneric(data: any): ApiChatToolCall[] {
  if (Array.isArray(data?.choices) && data.choices.length > 0) {
    const choice = data.choices[0];
    if (choice.message?.tool_calls && Array.isArray(choice.message.tool_calls)) {
      // OpenRouter / Standard OpenAI
      const toolCalls = choice.message.tool_calls;

      // Map encryption details from OpenRouter if available
      if (Array.isArray(choice.message.reasoning_details)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        choice.message.reasoning_details.forEach((rd: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const match = toolCalls.find((tc: any) => tc.id === rd.id);
          if (match && rd.type === 'reasoning.encrypted' && rd.data) {
            // We append signature to the tool call object
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (match as any).signature = rd.data;
          }
        });
      }

      return toolCalls;
    }
  }
  return [];
}

const DEFAULT_HANDLER: ProviderResponseHandler = {
  extractMessage: extractMessageGeneric,
  extractToolCalls: extractToolsGeneric,
  getStreamingReply: (data) => ({
    delta: data?.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '',
    tool_call_deltas: data?.choices?.[0]?.delta?.tool_calls || undefined,
  }),
};

// Handlers for providers that support reasoning via standard/Deepseek-like fields
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GENERIC_REASONING_EXTRACTOR = (data: any) =>
  data?.choices?.[0]?.message?.reasoning_content ?? data?.choices?.[0]?.message?.reasoning;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GENERIC_REASONING_STREAMER = (data: any) => ({
  delta: data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '',
  reasoning:
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.choices?.filter((x: any) => x?.delta?.reasoning_content)?.[0]?.delta?.reasoning_content ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.choices?.filter((x: any) => x?.delta?.reasoning)?.[0]?.delta?.reasoning ??
    '',
  tool_call_deltas: data?.choices?.[0]?.delta?.tool_calls || undefined,
});

export const PROVIDER_HANDLERS: Partial<Record<ApiProvider, ProviderResponseHandler>> = {
  [api_providers.CLAUDE]: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extractMessage: (data) => data?.content?.find((p: any) => p.type === 'text')?.text ?? '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extractReasoning: (data) => data?.content?.find((p: any) => p.type === 'thinking')?.thinking,
    extractToolCalls: (data) => {
      // Claude to OpenAI format conversion
      if (Array.isArray(data?.content)) {
        return (
          data.content
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((c: any) => c.type === 'tool_use')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((c: any) => ({
              id: c.id,
              type: 'function',
              function: {
                name: c.name,
                arguments: JSON.stringify(c.input),
              },
            }))
        );
      }
      return [];
    },
    getStreamingReply: (data) => {
      // Claude Streaming Logic
      const deltaText = data?.delta?.text || '';
      const thinking = data?.delta?.thinking || '';
      const toolCallDeltas: ApiChatToolCallDelta[] = [];

      // 1. Tool Start (content_block_start with tool_use)
      if (data?.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
        toolCallDeltas.push({
          index: data.index,
          id: data.content_block.id,
          type: 'function',
          function: {
            name: data.content_block.name,
            arguments: '',
          },
        });
      }

      // 2. Tool Delta (content_block_delta with input_json_delta)
      if (data?.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
        toolCallDeltas.push({
          index: data.index,
          function: {
            arguments: data.delta.partial_json,
          },
        });
      }

      return {
        delta: deltaText,
        reasoning: thinking,
        tool_call_deltas: toolCallDeltas.length > 0 ? toolCallDeltas : undefined,
      };
    },
  },
  [api_providers.COHERE]: {
    extractMessage: extractMessageGeneric,
    extractToolCalls: (data) => {
      if (data?.message?.tool_calls && Array.isArray(data.message.tool_calls)) {
        return data.message.tool_calls;
      }
      return [];
    },
    getStreamingReply: (data) => {
      // Cohere text delta is in a 'text-generation' event type
      const deltaText = data.type === 'text-generation' ? (data.text ?? '') : '';

      const toolCallDeltas: ApiChatToolCallDelta[] = [];
      const cohereToolEvents = ['tool-call-start', 'tool-call-delta', 'tool-call-end'];

      // Process Cohere's structured tool call stream events
      if (cohereToolEvents.includes(data?.type) && typeof data?.delta?.message === 'object') {
        const toolCallDelta = data.delta.message;
        // Add the tool call's index for the accumulator to correctly merge deltas
        toolCallDelta.index = data.index ?? 0;
        toolCallDeltas.push(toolCallDelta);
      }

      return {
        delta: deltaText,
        tool_call_deltas: toolCallDeltas.length > 0 ? toolCallDeltas : undefined,
      };
    },
  },
  [api_providers.OLLAMA]: {
    extractMessage: (data) => data?.response ?? data?.message?.content ?? '',
    extractToolCalls: extractToolsGeneric, // Ollama uses standard OpenAI format now
    getStreamingReply: (data, formatter) => {
      if (formatter === 'chat') {
        return { delta: data?.response ?? data?.message?.content ?? '' };
      }
      return {
        delta: data?.choices?.[0]?.text || '',
        reasoning: data?.choices?.[0]?.thinking || '',
      };
    },
  },
  [api_providers.MAKERSUITE]: {
    extractMessage: (data) =>
      data?.candidates?.[0]?.content?.parts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.filter((p: any) => !p.thought && !p.functionCall)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.map((p: any) => p.text)
        ?.join('') ?? '',
    extractReasoning: (data) =>
      data?.candidates?.[0]?.content?.parts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.filter((p: any) => p.thought)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.map((p: any) => p.text)
        ?.join('\n\n') ?? '',
    extractImages: (data) => {
      const inlineData = data?.responseContent?.parts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.filter((x: any) => x.inlineData && !x.thought)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.map((x: any) => x.inlineData);
      if (Array.isArray(inlineData) && inlineData.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return inlineData.map((x: any) => `data:${x.mimeType};base64,${x.data}`).filter(isDataURL);
      }
      return [];
    },
    extractToolCalls: (data) => {
      // Google to OpenAI format
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts = data?.candidates?.[0]?.content?.parts?.filter((p: any) => p.functionCall);
      if (parts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return parts.map((p: any) => ({
          id: Math.random().toString(36).substring(7), // Google doesn't return IDs
          type: 'function',
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args),
          },
          signature: p.thoughtSignature,
        }));
      }
      return [];
    },
    getStreamingReply: (data) => {
      const images: string[] = [];

      const inlineData =
        data?.candidates?.[0]?.content?.parts
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.filter((x: any) => x.inlineData && !x.thought)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.map((x: any) => x.inlineData) || [];
      if (Array.isArray(inlineData) && inlineData.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        images.push(...inlineData.map((x: any) => `data:${x.mimeType};base64,${x.data}`).filter(isDataURL));
      }

      const toolCallDeltas: ApiChatToolCallDelta[] = [];
      const parts = data?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parts.forEach((p: any, index: number) => {
          if (p.functionCall) {
            toolCallDeltas.push({
              index: index,
              id: Math.random().toString(36).substring(7),
              type: 'function',
              function: {
                name: p.functionCall.name,
                arguments: JSON.stringify(p.functionCall.args),
              },
              signature: p.thoughtSignature,
            });
          }
        });
      }

      return {
        delta:
          data?.candidates?.[0]?.content?.parts
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ?.filter((x: any) => !x.thought && !x.functionCall)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ?.map((x: any) => x.text)?.[0] || '',
        reasoning:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data?.candidates?.[0]?.content?.parts?.filter((x: any) => x.thought)?.map((x: any) => x.text)?.[0] || '',
        images,
        tool_call_deltas: toolCallDeltas.length > 0 ? toolCallDeltas : undefined,
      };
    },
  },
  [api_providers.VERTEXAI]: {
    extractMessage: (data) =>
      data?.candidates?.[0]?.content?.parts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.filter((p: any) => !p.thought && !p.functionCall)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.map((p: any) => p.text)
        ?.join('') ?? '',
    extractReasoning: (data) =>
      data?.candidates?.[0]?.content?.parts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.filter((p: any) => p.thought)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.map((p: any) => p.text)
        ?.join('\n\n') ?? '',
    extractImages: (data) => {
      const inlineData = data?.responseContent?.parts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.filter((x: any) => x.inlineData && !x.thought)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.map((x: any) => x.inlineData);
      if (Array.isArray(inlineData) && inlineData.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return inlineData.map((x: any) => `data:${x.mimeType};base64,${x.data}`).filter(isDataURL);
      }
      return [];
    },
    extractToolCalls: (data) => {
      // Google to OpenAI format
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts = data?.candidates?.[0]?.content?.parts?.filter((p: any) => p.functionCall);
      if (parts) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return parts.map((p: any) => ({
          id: Math.random().toString(36).substring(7),
          type: 'function',
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args),
          },
          signature: p.thoughtSignature,
        }));
      }
      return [];
    },
    getStreamingReply: (data) => {
      const images: string[] = [];

      const inlineData =
        data?.candidates?.[0]?.content?.parts
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.filter((x: any) => x.inlineData && !x.thought)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.map((x: any) => x.inlineData) || [];
      if (Array.isArray(inlineData) && inlineData.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        images.push(...inlineData.map((x: any) => `data:${x.mimeType};base64,${x.data}`).filter(isDataURL));
      }

      // Handle Vertex Streaming Tool Calls (Same as MakerSuite)
      const toolCallDeltas: ApiChatToolCallDelta[] = [];
      const parts = data?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parts.forEach((p: any, index: number) => {
          if (p.functionCall) {
            toolCallDeltas.push({
              index: index,
              id: Math.random().toString(36).substring(7),
              type: 'function',
              function: {
                name: p.functionCall.name,
                arguments: JSON.stringify(p.functionCall.args),
              },
              signature: p.thoughtSignature,
            });
          }
        });
      }

      return {
        delta:
          data?.candidates?.[0]?.content?.parts
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ?.filter((x: any) => !x.thought && !x.functionCall)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ?.map((x: any) => x.text)?.[0] || '',
        reasoning:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data?.candidates?.[0]?.content?.parts?.filter((x: any) => x.thought)?.map((x: any) => x.text)?.[0] || '',
        images,
        tool_call_deltas: toolCallDeltas.length > 0 ? toolCallDeltas : undefined,
      };
    },
  },
  [api_providers.MISTRALAI]: {
    extractMessage: (data) => {
      const content = data?.choices?.[0]?.message?.content;
      return Array.isArray(content)
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content.map((x: any) => x.text).join('')
        : (content ?? '');
    },
    extractReasoning: (data) =>
      data?.choices?.[0]?.message?.content?.[0]?.thinking
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.map((p: any) => p.text)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.filter((x: any) => x)
        ?.join('\n\n') ?? '',
    extractToolCalls: extractToolsGeneric,
    getStreamingReply: (data) => {
      const content = data.choices?.[0]?.delta?.content;
      // Handle array or string content safely
      const delta = Array.isArray(content)
        ? content
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((x: any) => x.text)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((x: any) => x)
            .join('')
        : content || '';

      return {
        delta,
        reasoning:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data.choices?.filter((x: any) => x?.delta?.content?.[0]?.thinking)?.[0]?.delta?.content?.[0]?.thinking?.[0]
            ?.text || '',
        tool_call_deltas: data?.choices?.[0]?.delta?.tool_calls || undefined,
      };
    },
  },
  [api_providers.OPENROUTER]: {
    extractMessage: DEFAULT_HANDLER.extractMessage,
    extractReasoning: GENERIC_REASONING_EXTRACTOR,
    extractToolCalls: extractToolsGeneric,
    extractImages: (data) => {
      const imageUrl = data?.choices[0]?.message?.images
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.filter((x: any) => x.type === 'image_url')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?.map((x: any) => x?.image_url?.url);
      if (Array.isArray(imageUrl) && imageUrl.length > 0) {
        return imageUrl.filter(isDataURL);
      }
      return [];
    },
    getStreamingReply: (data) => {
      const images: string[] = [];

      const imageUrls =
        data?.choices?.[0]?.delta?.images
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.filter((x: any) => x.type === 'image_url')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.map((x: any) => x?.image_url?.url) || [];
      if (Array.isArray(imageUrls) && imageUrls.length > 0) {
        images.push(...imageUrls.filter(isDataURL));
      }

      return {
        delta:
          data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '',
        reasoning:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data.choices?.filter((x: any) => x?.delta?.reasoning_content)?.[0]?.delta?.reasoning_content ??
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data.choices?.filter((x: any) => x?.delta?.reasoning)?.[0]?.delta?.reasoning ??
          '',
        images,
        tool_call_deltas: data?.choices?.[0]?.delta?.tool_calls || undefined,
      };
    },
  },
};

// Populate generic handlers for reasoning providers
const REASONING_SUPPORTED = [
  api_providers.DEEPSEEK,
  api_providers.XAI,
  api_providers.AIMLAPI,
  api_providers.POLLINATIONS,
  api_providers.MOONSHOT,
  api_providers.COMETAPI,
  api_providers.ELECTRONHUB,
  api_providers.NANOGPT,
  api_providers.ZAI,
  api_providers.CUSTOM,
];

REASONING_SUPPORTED.forEach((p) => {
  PROVIDER_HANDLERS[p] = {
    extractMessage: DEFAULT_HANDLER.extractMessage,
    extractReasoning: GENERIC_REASONING_EXTRACTOR,
    extractToolCalls: extractToolsGeneric,
    getStreamingReply: GENERIC_REASONING_STREAMER,
  };
});

// Default handler for all other providers (OpenAI, etc)
export function getProviderHandler(provider: ApiProvider): ProviderResponseHandler {
  return PROVIDER_HANDLERS[provider] || DEFAULT_HANDLER;
}

// --- Helper Transforms ---

const googleStopTransform = (v: string[]) => v?.slice(0, 5).filter((x) => x.length >= 1 && x.length <= 16);
const cohereStopTransform = (v: string[]) => v?.slice(0, 5);
const zaiStopTransform = (v: string[]) => v?.slice(0, 1);

const allProviders = Object.values(api_providers);
const allowAll = allProviders.reduce((acc, p) => ({ ...acc, [p]: {} }), {}) as Record<ApiProvider, ParamHandling>;

function allowExcept(exclude: ApiProvider[]) {
  const allowed = { ...allowAll };
  for (const p of exclude) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (allowed as any)[p];
  }
  return allowed;
}

// --- Parameter Definitions ---

export const PARAMETER_DEFINITIONS: Partial<Record<keyof SamplerSettings, ParamConfiguration>> = {
  stream: {
    providers: allowAll,
  },
  max_tokens: {
    providers: allowExcept([api_providers.POLLINATIONS]),
    formatterRules: [
      {
        formatter: ['text'],
        providers: [api_providers.OLLAMA],
        rule: { remoteKey: 'options.num_predict' },
      },
    ],
    modelRules: [
      { pattern: /^(o1|o3|o4)/, rule: { remoteKey: 'max_completion_tokens' } },
      { pattern: /^gpt-5/, rule: { remoteKey: 'max_completion_tokens' } },
    ],
  },
  max_context: {
    providers: allowAll,
    formatterRules: [
      {
        formatter: ['text'],
        providers: [api_providers.OLLAMA],
        rule: { remoteKey: 'options.num_ctx' },
      },
      {
        formatter: ['chat'],
        providers: [api_providers.OLLAMA],
        rule: null,
      },
    ],
  },

  temperature: {
    providers: allowExcept([api_providers.OLLAMA]),
    formatterRules: [
      {
        formatter: ['text'],
        providers: [api_providers.OLLAMA],
        rule: { remoteKey: 'options.temperature' },
      },
    ],
    modelRules: [{ pattern: /^(o1|o3|o4)/, rule: null }],
  },

  frequency_penalty: {
    providers: {
      ...allowExcept([api_providers.ZAI]),
      [api_providers.COHERE]: { min: 0, max: 1 },
    },
    formatterRules: [
      {
        formatter: ['text'],
        providers: [api_providers.OLLAMA],
        rule: { remoteKey: 'options.frequency_penalty' },
      },
    ],
    modelRules: [
      { pattern: /^(o1|o3|o4)/, rule: null },
      { pattern: /grok-3-mini/, rule: null },
      { pattern: /(grok-4|grok-code)/, rule: null },
      { pattern: /gpt-5(\.1)?/, rule: null },
    ],
  },

  presence_penalty: {
    providers: {
      ...allowExcept([api_providers.ZAI]),
      [api_providers.COHERE]: { min: 0, max: 1 },
    },
    formatterRules: [
      {
        formatter: ['text'],
        providers: [api_providers.OLLAMA],
        rule: { remoteKey: 'options.presence_penalty' },
      },
    ],
    modelRules: [
      { pattern: /^(o1|o3|o4)/, rule: null },
      { pattern: /grok-3-mini/, rule: null },
      { pattern: /(grok-4|grok-code)/, rule: null },
      { pattern: /gpt-5(\.1)?/, rule: null },
    ],
  },

  top_p: {
    providers: {
      ...allowAll,
      [api_providers.COHERE]: { min: 0.01, max: 0.99 },
      [api_providers.ZAI]: { transform: (v) => v || 0.01 },
      [api_providers.DEEPSEEK]: { transform: (v) => v || Number.EPSILON },
    },
    formatterRules: [
      {
        formatter: ['text'],
        providers: [api_providers.OLLAMA],
        rule: { remoteKey: 'options.top_p' },
      },
    ],
    modelRules: [{ pattern: /^(o1|o3|o4)/, rule: null }],
  },

  top_k: {
    providers: {
      [api_providers.CLAUDE]: {},
      [api_providers.OPENROUTER]: {},
      [api_providers.MAKERSUITE]: {},
      [api_providers.VERTEXAI]: {},
      [api_providers.COHERE]: {},
      [api_providers.PERPLEXITY]: {},
      [api_providers.ELECTRONHUB]: {},
      [api_providers.KOBOLDCPP]: {},
      [api_providers.OLLAMA]: {},
    },
    formatterRules: [
      {
        formatter: ['text'],
        providers: [api_providers.OLLAMA],
        rule: { remoteKey: 'options.top_k' },
      },
      {
        formatter: ['chat'],
        providers: [api_providers.OLLAMA],
        rule: null,
      },
    ],
  },

  top_a: {
    providers: {
      [api_providers.OPENROUTER]: {},
      [api_providers.KOBOLDCPP]: {},
    },
  },

  min_p: {
    providers: {
      [api_providers.OPENROUTER]: {},
      [api_providers.KOBOLDCPP]: {},
      [api_providers.OLLAMA]: {},
    },
    formatterRules: [
      {
        formatter: ['text'],
        providers: [api_providers.OLLAMA],
        rule: { remoteKey: 'options.min_p' },
      },
      {
        formatter: ['chat'],
        providers: [api_providers.OLLAMA],
        rule: null,
      },
    ],
  },

  repetition_penalty: {
    providers: {
      [api_providers.OPENROUTER]: {},
      [api_providers.KOBOLDCPP]: { remoteKey: 'rep_pen' },
      [api_providers.OLLAMA]: {},
    },
    formatterRules: [
      {
        formatter: ['text'],
        providers: [api_providers.OLLAMA],
        rule: { remoteKey: 'options.repeat_penalty' },
      },
      {
        formatter: ['chat'],
        providers: [api_providers.OLLAMA],
        rule: null,
      },
    ],
  },

  seed: {
    defaults: {
      transform: (v) => (typeof v === 'number' && v >= 0 ? v : undefined),
    },
    providers: allowAll,
    formatterRules: [
      {
        formatter: ['text'],
        providers: [api_providers.OLLAMA],
        rule: { remoteKey: 'options.seed' },
      },
    ],
  },

  stop: {
    defaults: {
      transform: (v: string[]) => (v && v.length > 0 ? v : undefined),
    },
    providers: {
      ...allowExcept([api_providers.PERPLEXITY]),
      [api_providers.COHERE]: { transform: cohereStopTransform },
      [api_providers.MAKERSUITE]: { transform: googleStopTransform },
      [api_providers.VERTEXAI]: { transform: googleStopTransform },
      [api_providers.ZAI]: { transform: zaiStopTransform },
    },
    modelRules: [
      { pattern: /^(o1|o3|o4)/, rule: null },
      { pattern: /(?=.*gpt)(?=.*vision)/, rule: null },
      { pattern: /grok-3-mini/, rule: null },
      { pattern: /grok-4(?!.*fast-non-reasoning)/, rule: null },
      { pattern: /^gpt-5/, rule: null },
    ],
    formatterRules: [
      {
        formatter: ['text'],
        providers: [api_providers.OLLAMA],
        rule: { remoteKey: 'options.stop' },
      },
    ],
  },

  n: {
    providers: allowExcept([api_providers.GROQ, api_providers.XAI, api_providers.OLLAMA]),
    modelRules: [{ pattern: /^(o1|o3|o4)/, rule: null }],
  },
};

// --- Provider Injections ---

export const PROVIDER_INJECTIONS: Partial<Record<string, InjectionFunction>> = {
  [api_providers.CLAUDE]: (payload, { samplerSettings }) => {
    payload.claude_use_sysprompt = samplerSettings.providers.claude?.use_sysprompt;
    payload.assistant_prefill = samplerSettings.providers.claude?.assistant_prefill;
    payload.top_k = samplerSettings.top_k;
  },

  [api_providers.MISTRALAI]: (payload) => {
    payload.safe_prompt = false;
  },

  [api_providers.MAKERSUITE]: (payload, { samplerSettings }) => {
    payload.use_makersuite_sysprompt = samplerSettings.providers.google?.use_makersuite_sysprompt;
  },

  [api_providers.VERTEXAI]: (payload, { samplerSettings, providerSpecific }) => {
    payload.use_makersuite_sysprompt = samplerSettings.providers.google?.use_makersuite_sysprompt;
    if (providerSpecific?.vertexai) {
      payload.vertexai_auth_mode = providerSpecific.vertexai.auth_mode;
      payload.vertexai_region = providerSpecific.vertexai.region;
      payload.vertexai_express_project_id = providerSpecific.vertexai.express_project_id;
    }
  },

  [api_providers.OPENROUTER]: (payload, { providerSpecific }) => {
    payload.use_fallback = providerSpecific.openrouter.useFallback;
    payload.provider = providerSpecific.openrouter?.providers;
    payload.allow_fallbacks = providerSpecific.openrouter.allowFallbacks;
    payload.middleout = providerSpecific.openrouter.middleout;
  },

  [api_providers.CUSTOM]: (payload, { providerSpecific, proxy }) => {
    payload.custom_url = providerSpecific.custom?.url;
    payload.custom_include_body = providerSpecific.custom?.include_body;
    payload.custom_exclude_body = providerSpecific.custom?.exclude_body;
    payload.custom_include_headers = providerSpecific.custom?.include_headers;
    if (proxy?.url) {
      payload.reverse_proxy = proxy.url;
    }
    if (proxy?.password) {
      payload.proxy_password = proxy.password;
    }
  },

  [api_providers.AZURE_OPENAI]: (payload, { providerSpecific }) => {
    if (providerSpecific.azure_openai) {
      payload.azure_base_url = providerSpecific.azure_openai.baseUrl;
      payload.azure_deployment_name = providerSpecific.azure_openai.deploymentName;
      payload.azure_api_version = providerSpecific.azure_openai.apiVersion;
    }
  },

  [api_providers.ZAI]: (payload, { providerSpecific }) => {
    if (providerSpecific?.zai?.endpoint) {
      payload.zai_endpoint = providerSpecific.zai.endpoint;
    }
  },

  [api_providers.GROQ]: (payload) => {
    delete payload.logprobs;
    delete payload.logit_bias;
    delete payload.top_logprobs;
    delete payload.n;
  },

  [api_providers.KOBOLDCPP]: (payload, { providerSpecific, samplerSettings, formatter }) => {
    const disabledGroups = samplerSettings.providers.disabled_fields?.koboldcpp || [];

    // Inject KoboldCpp specific settings
    const kSettings = samplerSettings.providers.koboldcpp;
    if (kSettings) {
      // Basic
      if (!disabledGroups.includes('koboldcpp_basic')) {
        if (kSettings.rep_pen_range !== undefined) payload.rep_pen_range = kSettings.rep_pen_range;
        if (kSettings.sampler_order && kSettings.sampler_order.length > 0)
          payload.sampler_order = kSettings.sampler_order;
      }

      // Dynatemp
      if (!disabledGroups.includes('koboldcpp_dynatemp')) {
        if (kSettings.dynatemp_range !== undefined) payload.dynatemp_range = kSettings.dynatemp_range;
        if (kSettings.dynatemp_exponent !== undefined) payload.dynatemp_exponent = kSettings.dynatemp_exponent;
        if (kSettings.smoothing_factor !== undefined) payload.smoothing_factor = kSettings.smoothing_factor;
      }

      // Mirostat
      if (!disabledGroups.includes('koboldcpp_mirostat')) {
        if (kSettings.mirostat !== undefined) payload.mirostat = kSettings.mirostat;
        if (kSettings.mirostat_tau !== undefined) payload.mirostat_tau = kSettings.mirostat_tau;
        if (kSettings.mirostat_eta !== undefined) payload.mirostat_eta = kSettings.mirostat_eta;
      }

      // Grammar & Bans
      if (!disabledGroups.includes('koboldcpp_grammar')) {
        if (kSettings.grammar) payload.grammar = kSettings.grammar;
        if (kSettings.grammar_retain_state !== undefined) payload.grammar_retain_state = kSettings.grammar_retain_state;
        if (kSettings.use_default_badwordsids !== undefined)
          payload.use_default_badwordsids = kSettings.use_default_badwordsids;
        // Arrays
        if (kSettings.banned_tokens) {
          const val = kSettings.banned_tokens;
          if (typeof val === 'string') {
            payload.banned_tokens = (val as string)
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
          } else if (Array.isArray(val)) {
            payload.banned_tokens = val;
          }
        }
      }

      // TFS
      if (!disabledGroups.includes('koboldcpp_tfs')) {
        if (kSettings.tfs !== undefined) payload.tfs = kSettings.tfs;
        if (kSettings.typical !== undefined) payload.typical = kSettings.typical;
      }

      // DRY
      if (!disabledGroups.includes('koboldcpp_dry')) {
        if (kSettings.dry_multiplier !== undefined) payload.dry_multiplier = kSettings.dry_multiplier;
        if (kSettings.dry_base !== undefined) payload.dry_base = kSettings.dry_base;
        if (kSettings.dry_allowed_length !== undefined) payload.dry_allowed_length = kSettings.dry_allowed_length;
        if (kSettings.dry_penalty_last_n !== undefined) payload.dry_penalty_last_n = kSettings.dry_penalty_last_n;

        if (kSettings.dry_sequence_breakers) {
          const val = kSettings.dry_sequence_breakers;
          if (typeof val === 'string') {
            payload.dry_sequence_breakers = (val as string)
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
          } else if (Array.isArray(val)) {
            payload.dry_sequence_breakers = val;
          }
        }
      }

      // XTC
      if (!disabledGroups.includes('koboldcpp_xtc')) {
        if (kSettings.xtc_threshold !== undefined) payload.xtc_threshold = kSettings.xtc_threshold;
        if (kSettings.xtc_probability !== undefined) payload.xtc_probability = kSettings.xtc_probability;
        if (kSettings.nsigma !== undefined) payload.nsigma = kSettings.nsigma;
      }
    }

    if (formatter === 'text') {
      // Text Completion Mode
      // We use the specialized text completion endpoint which expects params at root (or via api_type handling)
      payload.chat_completion_source = api_providers.KOBOLDCPP;
      payload.koboldcpp_server = providerSpecific.koboldcpp.url;
      // Remove chat-specific keys if any
      delete payload.messages;
    } else {
      // Chat Completion Mode
      // We use the Generic CUSTOM provider to proxy the request
      payload.chat_completion_source = api_providers.CUSTOM;
      payload.custom_url = providerSpecific.koboldcpp.url;

      const body: Record<string, unknown> = {};

      const ignoredPayloadKeys = [
        'chat_completion_source',
        'custom_url',
        'custom_include_body',
        'custom_exclude_body',
        'custom_include_headers',
        'model',
        'include_reasoning',
      ];
      const allowedRootKeys = ['stream'];
      for (const [key, value] of Object.entries(payload)) {
        if (!ignoredPayloadKeys.includes(key)) {
          body[key] = value;
          if (!allowedRootKeys.includes(key)) {
            delete payload[key];
          }
        }
      }

      delete payload.model;
      delete payload.include_reasoning;
      payload.custom_include_body = YAML.stringify(body);
    }
  },

  [api_providers.OLLAMA]: (payload, { providerSpecific, samplerSettings, formatter }) => {
    if (formatter === 'chat') {
      payload.chat_completion_source = api_providers.CUSTOM;
      payload.custom_url = providerSpecific.ollama.url.replace(/\/+$/, '');

      const body: Record<string, unknown> = {
        model: payload.model,
        messages: payload.messages,
        stream: payload.stream,
        stream_options: { include_usage: true },
        tools: payload.tools,
      };

      const ignoredPayloadKeys = [
        'chat_completion_source',
        'custom_url',
        'custom_include_body',
        'custom_exclude_body',
        'custom_include_headers',
        'stream',
      ];

      // Add other valid root keys to body (flattened params like temperature)
      for (const [key, value] of Object.entries(payload)) {
        if (!ignoredPayloadKeys.includes(key) && value !== undefined) {
          body[key] = value;
          if (key !== 'stream') {
            delete payload[key];
          }
        }
      }

      payload.custom_include_body = YAML.stringify(body);
    } else {
      const oSettings = samplerSettings.providers.ollama;
      const disabledGroups = samplerSettings.providers.disabled_fields?.ollama || [];

      if (oSettings && !disabledGroups.includes('ollama_advanced')) {
        if (!payload.options) payload.options = {};
        const opts = payload.options as Record<string, unknown>;
        if (oSettings.num_batch !== undefined) opts.num_batch = oSettings.num_batch;
        if (oSettings.num_keep !== undefined) opts.num_keep = oSettings.num_keep;
        if (oSettings.repeat_last_n !== undefined) opts.repeat_last_n = oSettings.repeat_last_n;
        if (oSettings.tfs_z !== undefined) opts.tfs_z = oSettings.tfs_z;
        if (oSettings.typical_p !== undefined) opts.typical_p = oSettings.typical_p;
      }

      payload.chat_completion_source = api_providers.OLLAMA;
      payload.ollama_server = providerSpecific.ollama?.url;
    }
  },
};

// --- Global Model Injections ---

const REASONING_EFFORT_PROVIDERS: ApiProvider[] = [
  api_providers.OPENAI,
  api_providers.AZURE_OPENAI,
  api_providers.CUSTOM,
  api_providers.XAI,
  api_providers.AIMLAPI,
  api_providers.OPENROUTER,
  api_providers.POLLINATIONS,
  api_providers.PERPLEXITY,
  api_providers.COMETAPI,
  api_providers.ELECTRONHUB,
];

export const MODEL_INJECTIONS: ModelInjection[] = [
  {
    // Global Reasoning Effort Logic
    pattern: /.*/,
    inject: (payload, { samplerSettings, provider, model, modelList }) => {
      if (!samplerSettings.reasoning_effort) return;
      if (!REASONING_EFFORT_PROVIDERS.includes(provider)) {
        payload.reasoning_effort = samplerSettings.reasoning_effort;
        return;
      }

      // Azure Specific Constraint: Reasoning effort not supported on older GPT-3/4 models
      if (provider === api_providers.AZURE_OPENAI && /^gpt-[34]/.test(model)) {
        return;
      }
      // XAI Constraint: only grok-3-mini supports reasoning effort currently
      if (provider === api_providers.XAI && !model.includes('grok-3-mini')) {
        return;
      }

      let reasoningEffort: ReasoningEffort | string | undefined = samplerSettings.reasoning_effort;

      switch (samplerSettings.reasoning_effort) {
        case ReasoningEffort.AUTO:
          reasoningEffort = undefined;
          break;
        case ReasoningEffort.MIN:
          // Special case for GPT-5 on OpenAI/Azure
          if ((provider === api_providers.OPENAI || provider === api_providers.AZURE_OPENAI) && /^gpt-5/.test(model)) {
            reasoningEffort = ReasoningEffort.MIN;
          } else {
            reasoningEffort = ReasoningEffort.LOW;
          }
          break;
        case ReasoningEffort.MAX:
          reasoningEffort = ReasoningEffort.HIGH;
          break;
        default:
          reasoningEffort = samplerSettings.reasoning_effort;
      }

      // ElectronHub specific validation
      if (provider === api_providers.ELECTRONHUB && Array.isArray(modelList) && reasoningEffort) {
        const currentModel = modelList.find((m) => m.id === model);
        const supportedEfforts = currentModel?.metadata?.supported_reasoning_efforts;
        if (Array.isArray(supportedEfforts) && !supportedEfforts.includes(reasoningEffort as string)) {
          reasoningEffort = undefined;
        }
      }

      if (reasoningEffort) {
        payload.reasoning_effort = reasoningEffort;
      }
    },
  },
  {
    // o1 / o3 / o4 reasoning models
    pattern: /^(o1|o3|o4)/,
    inject: (payload) => {
      if (payload.model?.startsWith('o1')) {
        payload.messages?.forEach((msg) => {
          // Ugly
          if (msg.role === 'system') (msg as unknown as ApiUserMessage).role = 'user';
        });
      }
      // Clean up params not supported by O-series
      delete payload.n;
      delete payload.tools;
      delete payload.tool_choice;
      delete payload.logprobs;
      delete payload.top_logprobs;
    },
  },
  {
    // GPT-5 constraints
    pattern: /^gpt-5/,
    inject: (payload) => {
      // Common GPT-5 removals

      delete payload.logprobs;
      delete payload.top_logprobs;

      if (/chat-latest/.test(payload.model || '')) {
        // Strict exclusions for chat-latest

        delete payload.tools;
        delete payload.tool_choice;
      } else {
        // Exclusions for other GPT-5 variants
        delete payload.temperature;
        delete payload.top_p;
        delete payload.frequency_penalty;
        delete payload.presence_penalty;
        delete payload.stop;

        delete payload.logit_bias;
      }
    },
  },
  {
    // Grok-4 / Grok-Code constraints
    pattern: /(grok-4|grok-code)/,
    inject: (payload, { model }) => {
      if (!model.includes('grok-4-fast-non-reasoning')) {
        delete payload.stop;
      }
    },
  },
  {
    // Vision model constraints (GPT-4 Vision, etc.)
    pattern: /(?=.*gpt)(?=.*vision)/,
    inject: (payload) => {
      delete payload.logit_bias;
      delete payload.stop;
      delete payload.logprobs;
    },
  },
];
