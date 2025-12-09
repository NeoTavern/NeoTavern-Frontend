import { useUiStore } from '../stores/ui.store';
import type { Character, CropData } from '../types';
import { getRequestHeaders } from '../utils/client';

const API_BASE = '/api/characters';

export async function fetchAllCharacters(): Promise<Character[]> {
  const response = await fetch(`${API_BASE}/all`, {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})); // Catch if json parsing fails
    throw new Error(errorData?.overflow ? 'overflow' : 'Failed to fetch characters');
  }

  return await response.json();
}

export async function fetchCharacterByAvatar(avatar: string): Promise<Character> {
  const response = await fetch(`${API_BASE}/get`, {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ avatar_url: avatar }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch character with avatar: ${avatar}`);
  }

  return await response.json();
}

export async function saveCharacter(character: Partial<Character> & { avatar: string }): Promise<void> {
  const response = await fetch(`${API_BASE}/merge-attributes`, {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(character),
    cache: 'no-cache',
  });

  if (!response.ok) {
    throw new Error('Failed to save character');
  }
}

export async function importCharacter(file: File): Promise<{ file_name: string; name: string }> {
  const uiStore = useUiStore();
  const format = file.name.split('.').pop()?.toLowerCase() ?? '';
  const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, '').toLowerCase();
  const formData = new FormData();
  formData.append('avatar', file);
  formData.append('preserved_name', fileNameWithoutExt);
  formData.append('file_type', format);
  formData.append('user_name', uiStore.activePlayerName || '');

  const response = await fetch(`${API_BASE}/import`, {
    method: 'POST',
    body: formData,
    headers: getRequestHeaders({ omitContentType: true }),
    cache: 'no-cache',
  });

  if (!response.ok) {
    throw new Error(`Failed to import character: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Server returned an error: ${data.error}`);
  }

  return data;
}

export async function createCharacter(formData: FormData, cropData?: CropData): Promise<{ file_name: string }> {
  let url = `${API_BASE}/create`;
  if (cropData) {
    url += `?crop=${encodeURIComponent(JSON.stringify(cropData))}`;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: getRequestHeaders({ omitContentType: true }),
    body: formData,
    cache: 'no-cache',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Creation request did not succeed.');
  }

  return { file_name: await response.text() };
}

export async function deleteCharacter(avatar: string, deleteChats: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/delete`, {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ avatar_url: avatar, delete_chats: deleteChats }),
    cache: 'no-cache',
  });

  if (!response.ok) {
    throw new Error('Failed to delete character');
  }
}

export async function updateCharacterImage(avatar: string, imageFile: File, cropData?: CropData | null): Promise<void> {
  const formData = new FormData();
  formData.append('avatar_url', avatar);
  formData.append('avatar', imageFile);

  let url = `${API_BASE}/edit-avatar`;
  if (cropData) {
    url += `?crop=${encodeURIComponent(JSON.stringify(cropData))}`;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: getRequestHeaders({ omitContentType: true }),
    body: formData,
    cache: 'no-cache',
  });

  if (!response.ok) {
    throw new Error('Failed to update avatar image');
  }
}

export async function exportCharacter(avatar: string, format: 'json' | 'png'): Promise<Blob> {
  const body = { format, avatar_url: avatar };

  const response = await fetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error('Failed to export character');
  }

  return await response.blob();
}
