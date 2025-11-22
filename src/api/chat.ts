import { getRequestHeaders } from '../utils/api';
import type { ChatInfo, FullChat } from '../types';

export async function fetchChat(chatFile: string): Promise<FullChat> {
  const response = await fetch('/api/chats/get', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      file_name: chatFile,
      avatar_url: '', // Means root level folder
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch chat history');
  }

  return await response.json();
}

export async function saveChat(chatFile: string, chatToSave?: FullChat): Promise<void> {
  const response = await fetch('/api/chats/save', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      file_name: chatFile,
      chat: chatToSave || [],
      avatar_url: '',
      force: false, // For now, we won't handle the integrity check failure popup
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    // TODO: Handle integrity check failure with a user prompt
    if (errorData?.error === 'integrity') {
      throw new Error('Chat integrity check failed. Data may be out of sync.');
    }
    throw new Error('Failed to save chat history');
  }
}

export async function listChats(): Promise<ChatInfo[]> {
  const response = await fetch('/api/characters/chats', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      avatar_url: '',
      metadata: true,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to list chat histories');
  }

  return await response.json();
}

export async function listRecentChats(): Promise<ChatInfo[]> {
  const response = await fetch('/api/chats/recent', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      avatar_url: '',
      metadata: true,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to list recent chat histories');
  }

  return await response.json();
}

export async function deleteChat(chatFile: string): Promise<void> {
  const fixedChatFile = !chatFile.endsWith('.jsonl') ? `${chatFile}.jsonl` : chatFile;
  const response = await fetch('/api/chats/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      chatfile: fixedChatFile,
      avatar_url: '',
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to delete chat history');
  }
}
