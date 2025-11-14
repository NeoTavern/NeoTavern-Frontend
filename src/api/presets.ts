import { getRequestHeaders } from '../utils/api';
import type { OaiSettings } from '../types';

export interface Preset {
  name: string;
  preset: Partial<OaiSettings>;
}

// TODO: apiId should be a type
export async function fetchAllPresets(apiId: string): Promise<Preset[]> {
  if (apiId === 'openai') {
    const response = await fetch('/api/settings/get', {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({}),
      cache: 'no-cache',
    });
    if (!response.ok) {
      throw new Error('Failed to fetch settings for presets');
    }
    const data = await response.json();

    const presets: Preset[] = [];
    // These keys are based on the original SillyTavern backend response
    const names = data.openai_setting_names ?? [];
    const settingsData = data.openai_settings ?? [];

    if (Array.isArray(names) && Array.isArray(settingsData)) {
      names.forEach((name: string, i: number) => {
        try {
          presets.push({
            name,
            preset: JSON.parse(settingsData[i]),
          });
        } catch (e) {
          console.error(`Failed to parse preset "${name}":`, settingsData[i]);
        }
      });
    }

    return presets;
  }
  return Promise.resolve([]);
}

export async function savePreset(apiId: string, name: string, preset: Partial<OaiSettings>): Promise<any> {
  const response = await fetch('/api/presets/save', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      apiId,
      name,
      preset,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to save preset');
  }

  return await response.json();
}

export async function deletePreset(apiId: string, name: string): Promise<any> {
  const response = await fetch('/api/presets/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ apiId, name }),
  });

  if (!response.ok) {
    throw new Error('Failed to delete preset');
  }

  return await response.json();
}
