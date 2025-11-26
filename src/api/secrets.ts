import type {
  CreateSecretRequest,
  DeleteSecretRequest,
  RenameSecretRequest,
  RotateSecretRequest,
  SecretCreatedResponse,
  SecretMap,
} from '../types/secrets';
import { getRequestHeaders } from '../utils/client';

export async function fetchSecrets(): Promise<SecretMap> {
  const response = await fetch('/api/secrets/read', {
    method: 'POST',
    headers: getRequestHeaders(),
  });
  if (!response.ok) throw new Error('Failed to fetch secrets');
  return response.json();
}

export async function createSecret(data: CreateSecretRequest): Promise<SecretCreatedResponse> {
  const response = await fetch('/api/secrets/write', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to create secret');
  return response.json();
}

export async function deleteSecret(data: DeleteSecretRequest): Promise<void> {
  const response = await fetch('/api/secrets/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to delete secret');
}

export async function renameSecret(data: RenameSecretRequest): Promise<void> {
  const response = await fetch('/api/secrets/rename', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to rename secret');
}

export async function rotateSecret(data: RotateSecretRequest): Promise<void> {
  const response = await fetch('/api/secrets/rotate', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to rotate secret');
}
