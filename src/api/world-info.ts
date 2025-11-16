import { getRequestHeaders } from '../utils/api';
import type { WorldInfoBook, WorldInfoEntry } from '../types';

export async function fetchAllWorldInfoNames(): Promise<string[]> {
  const response = await fetch('/api/settings/get', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error('Failed to fetch world info list');
  }
  const data = await response.json();
  return data.world_names ?? [];
}

export async function fetchWorldInfoBook(name: string): Promise<WorldInfoBook> {
  const response = await fetch('/api/worldinfo/get', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ name }),
    cache: 'no-cache',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch world info book: ${name}`);
  }
  const bookData = await response.json();

  let entriesArray: WorldInfoEntry[] = [];
  if (Array.isArray(bookData.entries)) {
    entriesArray = bookData.entries;
  } else if (typeof bookData.entries === 'object' && bookData.entries !== null) {
    entriesArray = Object.values(bookData.entries);
  }

  return { name, entries: entriesArray };
}

export async function saveWorldInfoBook(name: string, data: WorldInfoBook): Promise<void> {
  await fetch('/api/worldinfo/edit', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ name, data }),
  });
}

export async function deleteWorldInfoBook(name: string): Promise<void> {
  await fetch('/api/worldinfo/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ name }),
  });
}

export async function renameWorldInfoBook(oldName: string, newName: string): Promise<void> {
  // TODO: Implement a dedicated backend endpoint for this atomic operation.
  // This simulation is not safe for concurrent operations.
  console.warn(`renameWorldInfoBook API call not implemented. Simulating for now.`);
  const book = await fetchWorldInfoBook(oldName);
  await saveWorldInfoBook(newName, { ...book, name: newName });
  await deleteWorldInfoBook(oldName);
}

export async function duplicateWorldInfoBook(sourceName: string, newName: string): Promise<void> {
  // TODO: Implement a dedicated backend endpoint for this atomic operation.
  console.warn(`duplicateWorldInfoBook API call not implemented. Simulating for now.`);
  const book = await fetchWorldInfoBook(sourceName);
  await saveWorldInfoBook(newName, { ...book, name: newName });
}

export async function exportWorldInfoBook(name: string): Promise<WorldInfoBook> {
  return fetchWorldInfoBook(name);
}

export async function importWorldInfoBook(file: File): Promise<{ name: string }> {
  const formData = new FormData();
  formData.append('avatar', file); // 'avatar' is the key used in the original backend

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
