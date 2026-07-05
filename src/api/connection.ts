import { getRequestHeaders } from '../utils/client';
import type { ApiModel } from '../types';

export interface ConnectionStatusResponse {
  data?: ApiModel[];
  error?: string;
  bypass?: boolean;
}

export async function fetchChatCompletionStatus(settings: {
  chat_completion_source: string;
  reverse_proxy?: string;
  proxy_password?: string;
  custom_url?: string;
}): Promise<ConnectionStatusResponse> {
  const response = await fetch('/api/backends/chat-completions/status', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(settings),
    cache: 'no-cache',
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Error response text:', errorText);
    throw new Error(
      `Can't connect to ${settings.chat_completion_source} provider. Make sure AI Configuration is correct.`,
    );
  }

  return await response.json();
}

export async function fetchTextCompletionStatus(settings: {
  api_type: string;
  api_server?: string;
}): Promise<ConnectionStatusResponse> {
  const response = await fetch('/api/backends/text-completions/status', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(settings),
    cache: 'no-cache',
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Error response text:', errorText);
    throw new Error(`Can't connect to ${settings.api_type} provider. Make sure AI Configuration is correct.`);
  }

  return await response.json();
}
