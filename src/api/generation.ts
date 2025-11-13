import { getRequestHeaders } from '../utils/api';

export interface ApiChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatCompletionPayload {
  stream?: boolean;
  messages: ApiChatMessage[];
  model?: string;
  chat_completion_source?: string;
  max_tokens?: number;
  temperature?: number;
  // We can add other OpenAI params here as needed
}

export interface GenerationResponse {
  // TODO: No need role, need reasoning, possibly tool info
  role: 'assistant';
  content: string;
}

export class ChatCompletionService {
  static async generate(payload: ChatCompletionPayload): Promise<GenerationResponse> {
    const response = await fetch('/api/backends/chat-completions/generate', {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify(payload),
      cache: 'no-cache',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `Request failed with status ${response.status}`);
    }

    const responseData = await response.json();

    // TODO: Add extraction for each API's response format
    const messageContent =
      responseData?.choices?.[0]?.message?.content ??
      responseData?.choices?.[0]?.text ??
      responseData?.results?.[0]?.output?.text ??
      '';

    return {
      role: 'assistant',
      content: messageContent,
    };
  }
}
