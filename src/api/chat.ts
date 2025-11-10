import { getRequestHeaders } from '../utils/api';
import type { Character } from '../types';

export async function fetchChat(character: Character, chatMetadata: Record<string, any>): Promise<any[]> {
  const response = await fetch('/api/chats/get', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      ch_name: character.name,
      file_name: character.chat,
      avatar_url: character.avatar,
      chat_metadata: chatMetadata,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch chat history');
  }

  return await response.json();
}
