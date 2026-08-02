import type { WorldInfoBook, WorldInfoEntry, WorldInfoHeader } from '../types';
import { getRequestHeaders } from '../utils/client';
import { validateWorldInfoRole } from '../utils/world-info-role';

export async function listAllWorldInfoBooks(): Promise<WorldInfoHeader[]> {
  const response = await fetch('/api/worldinfo/list', {
    method: 'POST',
    headers: getRequestHeaders(),
    cache: 'no-cache',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch world info books list');
  }
  return (await response.json()) as WorldInfoHeader[];
}

export async function fetchWorldInfoBook(filename: string): Promise<WorldInfoBook> {
  const response = await fetch('/api/worldinfo/get', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ name: filename }),
    cache: 'no-cache',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch world info book: ${filename}`);
  }
  const bookData = (await response.json()) as WorldInfoBook;

  let entriesArray: WorldInfoEntry[] = [];
  if (Array.isArray(bookData.entries)) {
    entriesArray = bookData.entries;
  } else if (typeof bookData.entries === 'object' && bookData.entries !== null) {
    entriesArray = Object.values(bookData.entries);
  }

  return {
    ...bookData,
    entries: entriesArray.map((entry) => ({
      ...entry,
      role: validateWorldInfoRole(entry.role ?? entry.extensions?.role, `World Info book ${filename}/${entry.uid}`),
    })),
  };
}

export async function saveWorldInfoBook(filename: string, data: WorldInfoBook): Promise<void> {
  await fetch('/api/worldinfo/edit', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ name: filename, data }),
  });
}

export async function deleteWorldInfoBook(filename: string): Promise<void> {
  await fetch('/api/worldinfo/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ name: filename }),
  });
}

export async function importWorldInfoBook(file: File): Promise<{ name: string }> {
  const formData = new FormData();
  formData.append('avatar', file);

  const response = await fetch('/api/worldinfo/import', {
    method: 'POST',
    headers: getRequestHeaders({ omitContentType: true }),
    body: formData,
    cache: 'no-cache',
  });

  if (!response.ok) {
    throw new Error(`Failed to import world info: ${response.statusText}`);
  }
  return await response.json();
}
