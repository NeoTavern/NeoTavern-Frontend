import { getRequestHeaders } from '../utils/api';

export async function fetchAllPersonaAvatars(): Promise<string[]> {
  const response = await fetch('/api/avatars/get', {
    method: 'POST',
    headers: getRequestHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch persona avatars');
  }

  return await response.json();
}

export async function deletePersonaAvatar(avatarId: string): Promise<void> {
  const response = await fetch('/api/avatars/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ avatar: avatarId }),
  });

  if (!response.ok) {
    throw new Error('Failed to delete persona avatar');
  }
}

export async function uploadPersonaAvatar(formData: FormData, cropData?: any): Promise<{ path: string }> {
  let url = '/api/avatars/upload';
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
    throw new Error(`Failed to upload persona avatar: ${response.statusText}`);
  }

  return await response.json();
}
