import type { ChatInfo, FullChat } from '../types';
import { getRequestHeaders } from '../utils/client';

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

  let data = (await response.json()) as ChatInfo[];
  data = data.filter((chat) => chat.chat_metadata !== undefined);
  return data;
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

export interface ChatExportRequest {
  file: string;
  exportfilename: string;
  format: string;
}

export async function exportChat(body: ChatExportRequest): Promise<string> {
  const response = await fetch('/api/chats/export', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      ...body,
      avatar_url: '',
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message ?? 'Export failed');
  }
  return data.result;
}

export async function importChats(file_type: 'jsonl' | 'json', file: File): Promise<{ fileNames: string[] }> {
  const formData = new FormData();
  formData.append('file_type', file_type);
  formData.append('avatar_url', '');
  formData.append('avatar', file);
  formData.append('user_name', 'dummy'); // backend needs for backward compatibility
  formData.append('name', 'dummy'); // backend needs for backward compatibility

  const response = await fetch('/api/chats/import', {
    method: 'POST',
    headers: getRequestHeaders({ omitContentType: true }),
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error((data as any).message ?? 'Failed to import chats');
  }

  return await response.json();
}
