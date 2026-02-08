import { getRequestHeaders } from '../utils/client';

export interface UploadMediaRequest {
  ch_name?: string; // Character name context
  filename: string; // Desired filename (usually timestamp + random)
  format: string; // 'png', 'jpg', 'mp4', etc.
  image: string; // Base64 data
}

export interface UploadMediaResponse {
  path: string;
}

export async function uploadMedia(data: UploadMediaRequest): Promise<UploadMediaResponse> {
  const response = await fetch('/api/images/upload', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to upload media');
  }

  return await response.json();
}

export interface UploadFileRequest {
  name: string; // Filename
  data: string; // Base64 data
}

export interface UploadFileResponse {
  path: string;
}

export async function uploadFile(data: UploadFileRequest): Promise<UploadFileResponse> {
  const response = await fetch('/api/files/upload', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to upload file');
  }

  return await response.json();
}
