import { getRequestHeaders } from '../utils/api';
import type { Group } from '../types';

export async function fetchAllGroups(): Promise<Group[]> {
  const response = await fetch('/api/groups/all', {
    method: 'POST',
    headers: getRequestHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch groups');
  }

  return await response.json();
}
