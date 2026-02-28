import { getRequestHeaders } from '../utils/client';

export interface Background {
  filename: string;
  isAnimated: boolean;
}

export interface BackgroundListResponse {
  images: Background[];
  config: {
    width: number;
    height: number;
  };
}

export async function fetchAllBackgrounds(): Promise<BackgroundListResponse> {
  const response = await fetch('/api/backgrounds/all', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch backgrounds');
  }

  return await response.json();
}

export async function uploadBackground(formData: FormData): Promise<string> {
  const response = await fetch('/api/backgrounds/upload', {
    method: 'POST',
    headers: getRequestHeaders({ omitContentType: true }),
    body: formData,
    cache: 'no-cache',
  });

  if (!response.ok) {
    throw new Error('Failed to upload background');
  }

  return await response.text();
}

export async function renameBackground(oldName: string, newName: string): Promise<void> {
  const response = await fetch('/api/backgrounds/rename', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ old_bg: oldName, new_bg: newName }),
    cache: 'no-cache',
  });

  if (!response.ok) {
    throw new Error('Failed to rename background');
  }
}

export async function deleteBackground(fileName: string): Promise<void> {
  await fetch('/api/backgrounds/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ bg: fileName }),
  });
}
