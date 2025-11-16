import { getRequestHeaders } from '../utils/api';
import type { ChatCompletionSource, MessageRole, SamplerSettings } from '../types';
import { chat_completion_sources } from '../types';

export interface ApiChatMessage {
  role: MessageRole;
  content: string;
}

export interface ChatCompletionPayload {
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
  // TODO: Add other parameters
}

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
};
export function buildChatCompletionPayload({
  samplerSettings,
  messages,
  model,
  source,
}: BuildChatCompletionPayloadOptions): ChatCompletionPayload {
  // TODO: Add logic to only include parameters supported by the target API/model
  return {
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
  };
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
    case chat_completion_sources.OPENROUTER:
      return data?.choices?.[0]?.message?.reasoning;
    case chat_completion_sources.DEEPSEEK:
    case chat_completion_sources.XAI:
      return data?.choices?.[0]?.message?.reasoning_content;
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
    case chat_completion_sources.OPENROUTER:
      return {
        delta:
          data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '',
        reasoning: data.choices?.[0]?.delta?.reasoning || '',
      };
    case chat_completion_sources.DEEPSEEK:
    case chat_completion_sources.XAI:
      return {
        delta: data.choices?.[0]?.delta?.content || '',
        reasoning: data.choices?.filter((x: any) => x?.delta?.reasoning_content)?.[0]?.delta?.reasoning_content || '',
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

                if (chunk.reasoning) {
                  reasoning += chunk.reasoning;
                }

                if (chunk.delta) {
                  yield { delta: chunk.delta, reasoning: reasoning };
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
