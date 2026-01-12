import type { ReasoningTemplate, SamplerSettings } from '../types';
import type { InstructTemplate } from '../types/instruct';
import type { Theme } from '../types/theme';
import { getRequestHeaders } from '../utils/client';
import { fetchUserSettings } from './settings';

export interface Preset<T> {
  name: string;
  preset: T;
}

export async function fetchAllSamplerPresets(): Promise<Preset<SamplerSettings>[]> {
  const response = await fetch('/api/plugins/neo/samplers', {
    method: 'GET',
    headers: getRequestHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch sampler presets');
  }

  return await response.json();
}

export async function saveSamplerPreset(name: string, preset: SamplerSettings): Promise<void> {
  const response = await fetch('/api/plugins/neo/samplers', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ name, preset }),
  });

  if (!response.ok) {
    throw new Error('Failed to save preset');
  }
}

export async function deleteSamplerPreset(name: string): Promise<void> {
  const response = await fetch(`/api/plugins/neo/samplers/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: getRequestHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to delete preset');
  }
}

export async function fetchAllThemes(): Promise<Preset<Theme>[]> {
  const response = await fetch('/api/plugins/neo/themes', {
    method: 'GET',
    headers: getRequestHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch themes');
  }

  return await response.json();
}
export async function saveTheme(name: string, preset: Theme): Promise<void> {
  const response = await fetch('/api/plugins/neo/themes', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ name, preset }),
  });

  if (!response.ok) {
    throw new Error('Failed to save theme');
  }
}

export async function deleteTheme(name: string): Promise<void> {
  const response = await fetch(`/api/plugins/neo/themes/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: getRequestHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to delete theme');
  }
}

export async function fetchAllInstructTemplates(): Promise<InstructTemplate[]> {
  const userSettingsResponse = await fetchUserSettings();
  return userSettingsResponse.instruct;
}

export async function saveInstructTemplate(template: InstructTemplate): Promise<void> {
  const response = await fetch('/api/presets/save', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      apiId: 'instruct',
      name: template.name,
      preset: template,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to save instruct template');
  }

  await response.json();
}

export async function deleteInstructTemplate(name: string): Promise<void> {
  const response = await fetch('/api/presets/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      apiId: 'instruct',
      name: name,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to delete instruct template');
  }

  await response.json();
}

export async function fetchAllReasoningTemplates(): Promise<ReasoningTemplate[]> {
  const userSettingsResponse = await fetchUserSettings();
  return userSettingsResponse.reasoning;
}

export async function saveReasoningTemplate(template: ReasoningTemplate): Promise<void> {
  const response = await fetch('/api/presets/save', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      apiId: 'reasoning',
      name: template.name,
      preset: template,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to save reasoning template');
  }

  await response.json();
}

export async function deleteReasoningTemplate(name: string): Promise<void> {
  const response = await fetch('/api/presets/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      apiId: 'reasoning',
      name: name,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to delete reasoning template');
  }

  await response.json();
}
