import { getRequestHeaders } from '../utils/api';
import type { OaiSettings } from '../types';

export async function fetchChatCompletionStatus(settings: Partial<OaiSettings>): Promise<any> {
  const response = await fetch('/api/backends/chat-completions/status', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(settings),
    cache: 'no-cache',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to check status: ${response.statusText} - ${errorText}`);
  }

  return await response.json();
}
