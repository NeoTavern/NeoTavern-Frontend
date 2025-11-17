import { getRequestHeaders } from '../utils/api';
import type { ChatCompletionSource, MessageRole, SamplerSettings, Settings, ReasoningEffort, ApiModel } from '../types';
import { chat_completion_sources, ReasoningEffort as ReasoningEffortEnum } from '../types';
import type { OpenrouterMiddleoutType } from '../constants';

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
  playerName: string;
  characterName: string;
  modelList: ApiModel[];
};
export function buildChatCompletionPayload({
  samplerSettings,
  messages,
  model,
  source,
  providerSpecific,
  modelList,
}: BuildChatCompletionPayloadOptions): ChatCompletionPayload {
  const payload: ChatCompletionPayload = {
    messages,
    model,
    chat_completion_source: source,
    stream: samplerSettings.stream ?? true,
    max_tokens: samplerSettings.max_tokens,
    temperature: samplerSettings.temperature,
    frequency_penalty: samplerSettings.frequency_penalty,
    presence_penalty: samplerSettings.presence_penalty,
    repetition_penalty: samplerSettings.repetition_penalty,
    top_p: samplerSettings.top_p,
    top_k: samplerSettings.top_k,
    min_p: samplerSettings.min_p,
    top_a: samplerSettings.top_a,
    include_reasoning: !!samplerSettings.show_thoughts,
  };

  if (samplerSettings.reasoning_effort) {
    const reasoningEffortSources: ChatCompletionSource[] = [
      chat_completion_sources.OPENAI,
      chat_completion_sources.AZURE_OPENAI,
      chat_completion_sources.CUSTOM,
      chat_completion_sources.XAI,
      chat_completion_sources.AIMLAPI,
      chat_completion_sources.OPENROUTER,
      chat_completion_sources.POLLINATIONS,
      chat_completion_sources.PERPLEXITY,
      chat_completion_sources.COMETAPI,
      chat_completion_sources.ELECTRONHUB,
    ];

    let reasoningEffort: ReasoningEffort | string | undefined = samplerSettings.reasoning_effort;

    if (reasoningEffortSources.includes(source)) {
      switch (samplerSettings.reasoning_effort) {
        case ReasoningEffortEnum.AUTO:
          reasoningEffort = undefined;
          break;
        case ReasoningEffortEnum.MIN:
          reasoningEffort =
            // @ts-ignore
            [chat_completion_sources.OPENAI, chat_completion_sources.AZURE_OPENAI].includes(source) &&
            /^gpt-5/.test(model)
              ? ReasoningEffortEnum.MIN
              : ReasoningEffortEnum.LOW;
          break;
        case ReasoningEffortEnum.MAX:
          reasoningEffort = ReasoningEffortEnum.HIGH;
          break;
        default:
          reasoningEffort = samplerSettings.reasoning_effort;
      }

      if (source === chat_completion_sources.ELECTRONHUB) {
        if (Array.isArray(modelList) && reasoningEffort) {
          const currentModel = modelList.find((m) => m.id === model);
          const supportedEfforts = currentModel?.metadata?.supported_reasoning_efforts;
          if (Array.isArray(supportedEfforts) && !supportedEfforts.includes(reasoningEffort as string)) {
            reasoningEffort = undefined;
          }
        }
      }
    }

    if (reasoningEffort) {
      payload.reasoning_effort = reasoningEffort;
    }
  }

  // --- Seed ---
  const seedSupportedSources: ChatCompletionSource[] = [
    chat_completion_sources.OPENAI,
    chat_completion_sources.AZURE_OPENAI,
    chat_completion_sources.OPENROUTER,
    chat_completion_sources.MISTRALAI,
    chat_completion_sources.CUSTOM,
    chat_completion_sources.COHERE,
    chat_completion_sources.GROQ,
    chat_completion_sources.ELECTRONHUB,
    chat_completion_sources.NANOGPT,
    chat_completion_sources.XAI,
    chat_completion_sources.POLLINATIONS,
    chat_completion_sources.AIMLAPI,
    chat_completion_sources.VERTEXAI,
    chat_completion_sources.MAKERSUITE,
  ];
  if (samplerSettings.seed && samplerSettings.seed >= 0 && seedSupportedSources.includes(source)) {
    payload.seed = samplerSettings.seed;
  }

  // --- Stop Sequences ---
  if (samplerSettings.stop && samplerSettings.stop.length > 0) {
    payload.stop = samplerSettings.stop;
  }

  // --- Vision Model Checks ---
  const isVision = (m: string) => ['gpt', 'vision'].every((x) => m.includes(x));
  if (isVision(model)) {
    // delete payload.logit_bias; // TODO
    delete payload.stop;
    // delete payload.logprobs; // TODO
  }

  // --- Provider-Specific Logic ---
  const providers = samplerSettings.providers;
  switch (source) {
    case chat_completion_sources.CLAUDE:
      payload.claude_use_sysprompt = providers.claude?.use_sysprompt;
      payload.assistant_prefill = providers.claude?.assistant_prefill;
      break;
    case chat_completion_sources.OPENROUTER:
      payload.use_fallback = providerSpecific.openrouter.use_fallback;
      payload.provider = providerSpecific.openrouter?.providers;
      payload.allow_fallbacks = providerSpecific.openrouter.allow_fallbacks;
      payload.middleout = providerSpecific.openrouter.middleout;
      break;
    case chat_completion_sources.MAKERSUITE:
    case chat_completion_sources.VERTEXAI:
      payload.use_makersuite_sysprompt = providers.google?.use_makersuite_sysprompt;
      if (payload.stop) {
        payload.stop = payload.stop.slice(0, 5).filter((x) => x.length >= 1 && x.length <= 16);
      }
      break;
    case chat_completion_sources.MISTRALAI:
      payload.safe_prompt = false;
      break;
    case chat_completion_sources.COHERE:
      payload.top_p = Math.min(Math.max(payload.top_p ?? 0, 0.01), 0.99);
      payload.frequency_penalty = Math.min(Math.max(payload.frequency_penalty ?? 0, 0), 1);
      payload.presence_penalty = Math.min(Math.max(payload.presence_penalty ?? 0, 0), 1);
      if (payload.stop) {
        payload.stop = payload.stop.slice(0, 5);
      }
      break;
    case chat_completion_sources.PERPLEXITY:
      delete payload.stop;
      break;
    case chat_completion_sources.GROQ:
      // delete payload.logprobs; // TODO
      // delete payload.logit_bias; // TODO
      delete payload.n;
      break;
    case chat_completion_sources.DEEPSEEK:
      payload.top_p = payload.top_p || Number.EPSILON;
      break;
    case chat_completion_sources.XAI:
      if (model.includes('grok-3-mini')) {
        delete payload.presence_penalty;
        delete payload.frequency_penalty;
        delete payload.stop;
      } else if (model.includes('grok-4') || model.includes('grok-code')) {
        delete payload.presence_penalty;
        delete payload.frequency_penalty;
        if (!model.includes('grok-4-fast-non-reasoning')) {
          delete payload.stop;
        }
      }
      break;
    case chat_completion_sources.POLLINATIONS:
      delete payload.max_tokens;
      break;
    case chat_completion_sources.ZAI:
      payload.top_p = payload.top_p || 0.01;
      if (payload.stop) {
        payload.stop = payload.stop.slice(0, 1);
      }
      delete payload.presence_penalty;
      delete payload.frequency_penalty;
      break;
  }

  // --- Model-Specific Logic ---
  if (/^(o1|o3|o4)/.test(model)) {
    payload.max_completion_tokens = payload.max_tokens;
    delete payload.max_tokens;
    // delete payload.logprobs; // TODO
    delete payload.stop;
    // delete payload.logit_bias; // TODO
    delete payload.temperature;
    delete payload.top_p;
    delete payload.frequency_penalty;
    delete payload.presence_penalty;
    if (model.startsWith('o1')) {
      payload.messages?.forEach((msg) => {
        if (msg.role === 'system') msg.role = 'user';
      });
      delete payload.n;
    }
  } else if (/^gpt-5/.test(model)) {
    payload.max_completion_tokens = payload.max_tokens;
    delete payload.max_tokens;
    // delete payload.logprobs; // TODO
    if (!/chat-latest/.test(model)) {
      delete payload.temperature;
      delete payload.top_p;
      delete payload.frequency_penalty;
      delete payload.presence_penalty;
      // delete payload.logit_bias; // TODO
      delete payload.stop;
    }
  }

  return payload;
}

function handleApiError(data: any): void {
  if (data?.error) {
    const errorMessage = data.error.message || data.error.type || 'An unknown API error occurred.';
    if (data.error.code === 'insufficient_quota') {
      throw new Error('You have exceeded your current quota. Please check your plan and billing details.');
    }
    throw new Error(errorMessage);
  }
}

function extractMessage(data: any, source: ChatCompletionSource): string {
  if (typeof data === 'string') {
    return data;
  }

  switch (source) {
    case chat_completion_sources.CLAUDE:
      return data?.content?.find((p: any) => p.type === 'text')?.text ?? '';
    case chat_completion_sources.OPENAI:
    case chat_completion_sources.OPENROUTER:
    // Fallback for most OpenAI-compatible APIs
    default:
      return (
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        data?.results?.[0]?.output?.text ??
        data?.content?.[0]?.text ??
        ''
      );
  }
}

function extractReasoning(data: any, source: ChatCompletionSource): string | undefined {
  switch (source) {
    case chat_completion_sources.CLAUDE:
      return data?.content?.find((p: any) => p.type === 'thinking')?.thinking;
    case chat_completion_sources.MAKERSUITE:
    case chat_completion_sources.VERTEXAI:
      return (
        data?.responseContent?.parts
          ?.filter((p: any) => p.thought)
          ?.map((p: any) => p.text)
          ?.join('\n\n') ?? ''
      );
    case chat_completion_sources.MISTRALAI:
      return (
        data?.choices?.[0]?.message?.content?.[0]?.thinking
          ?.map((p: any) => p.text)
          ?.filter((x: any) => x)
          ?.join('\n\n') ?? ''
      );
    case chat_completion_sources.OPENROUTER:
    case chat_completion_sources.DEEPSEEK:
    case chat_completion_sources.XAI:
    case chat_completion_sources.AIMLAPI:
    case chat_completion_sources.POLLINATIONS:
    case chat_completion_sources.MOONSHOT:
    case chat_completion_sources.COMETAPI:
    case chat_completion_sources.ELECTRONHUB:
    case chat_completion_sources.NANOGPT:
    case chat_completion_sources.ZAI:
    case chat_completion_sources.CUSTOM:
      return data?.choices?.[0]?.message?.reasoning_content ?? data?.choices?.[0]?.message?.reasoning;
    default:
      return undefined;
  }
}

function getStreamingReply(data: any, source: ChatCompletionSource): { delta: string; reasoning?: string } {
  switch (source) {
    case chat_completion_sources.CLAUDE:
      return {
        delta: data?.delta?.text || '',
        reasoning: data?.delta?.thinking || '',
      };
    case chat_completion_sources.MAKERSUITE:
    case chat_completion_sources.VERTEXAI:
      return {
        delta:
          data?.candidates?.[0]?.content?.parts?.filter((x: any) => !x.thought)?.map((x: any) => x.text)?.[0] || '',
        reasoning:
          data?.candidates?.[0]?.content?.parts?.filter((x: any) => x.thought)?.map((x: any) => x.text)?.[0] || '',
      };
    case chat_completion_sources.MISTRALAI:
      return {
        delta:
          data.choices?.[0]?.delta?.content
            ?.map((x: any) => x.text)
            .filter((x: any) => x)
            .join('') || '',
        reasoning:
          data.choices?.filter((x: any) => x?.delta?.content?.[0]?.thinking)?.[0]?.delta?.content?.[0]?.thinking?.[0]
            ?.text || '',
      };
    case chat_completion_sources.OPENROUTER:
      return {
        delta:
          data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '',
        reasoning: data.choices?.filter((x: any) => x?.delta?.reasoning)?.[0]?.delta?.reasoning || '',
      };
    case chat_completion_sources.DEEPSEEK:
    case chat_completion_sources.XAI:
    case chat_completion_sources.CUSTOM:
    case chat_completion_sources.POLLINATIONS:
    case chat_completion_sources.AIMLAPI:
    case chat_completion_sources.MOONSHOT:
    case chat_completion_sources.COMETAPI:
    case chat_completion_sources.ELECTRONHUB:
    case chat_completion_sources.NANOGPT:
    case chat_completion_sources.ZAI:
      return {
        delta:
          data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '',
        reasoning:
          data.choices?.filter((x: any) => x?.delta?.reasoning_content)?.[0]?.delta?.reasoning_content ??
          data.choices?.filter((x: any) => x?.delta?.reasoning)?.[0]?.delta?.reasoning ??
          '',
      };
    // Fallback for OpenAI and compatible APIs
    case chat_completion_sources.OPENAI:
    default:
      return {
        delta:
          data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '',
      };
  }
}

export class ChatCompletionService {
  static async generate(
    payload: ChatCompletionPayload,
    signal?: AbortSignal,
  ): Promise<GenerationResponse | (() => AsyncGenerator<StreamedChunk>)> {
    const commonOptions = {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify(payload),
      cache: 'no-cache',
      signal,
    } satisfies RequestInit;

    if (!payload.stream) {
      const response = await fetch('/api/backends/chat-completions/generate', commonOptions);
      const responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON response' }));

      if (!response.ok) {
        handleApiError(responseData);
        throw new Error(`Request failed with status ${response.status}`);
      }
      handleApiError(responseData);

      const source = payload.chat_completion_source as ChatCompletionSource;
      const messageContent = extractMessage(responseData, source);
      const reasoning = extractReasoning(responseData, source);

      return {
        content: messageContent,
        reasoning: reasoning,
      };
    }

    const response = await fetch('/api/backends/chat-completions/generate', commonOptions);

    if (!response.ok || !response.body) {
      let errorMessage = `Request failed with status ${response.status}`;
      try {
        const errorText = await response.text();
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
      } catch (e) {
        // Not a JSON error, use the status text
      }
      throw new Error(errorMessage);
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

    return async function* streamData(): AsyncGenerator<StreamedChunk> {
      let reasoning = '';
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep the last, possibly incomplete, line

          for (const line of lines) {
            if (line.trim().startsWith('data: ')) {
              const data = line.trim().substring(6);
              if (data === '[DONE]') {
                return;
              }
              try {
                const parsed = JSON.parse(data);

                if (parsed.error) {
                  throw new Error(parsed.error.message || 'Unknown stream error');
                }

                const source = payload.chat_completion_source as ChatCompletionSource;
                const chunk = getStreamingReply(parsed, source);

                const hasNewReasoning = chunk.reasoning && chunk.reasoning.length > 0;
                const hasNewDelta = chunk.delta && chunk.delta.length > 0;

                if (hasNewReasoning) {
                  reasoning += chunk.reasoning;
                }

                if (hasNewDelta || hasNewReasoning) {
                  yield { delta: chunk.delta || '', reasoning: reasoning };
                }
              } catch (e) {
                console.error('Error parsing stream chunk:', data, e);
              }
            }
          }
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.debug('Stream aborted by user.');
        } else {
          throw error;
        }
      }
    };
  }
}
