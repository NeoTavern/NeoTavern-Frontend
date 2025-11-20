import type { LegacyOaiPresetSettings, LegacyOaiSettings, LegacySettings, SamplerSettings } from '../types';
import { getRequestHeaders } from '../utils/api';

export interface UserSettingsResponse {
  settings: string; // JSON string of LegacySettings
  openai_setting_names: string[];
  openai_settings: string[]; // JSON string of LegacyOaiPresetSettings
  v2ExperimentalSamplerPreset_names?: string[];
  v2ExperimentalSamplerPreset_settings?: string[]; // JSON string of SamplerSettings
  world_names: string[];
}

export interface ParsedUserSettingsResponse {
  settings: LegacySettings;
  openai_setting_names: string[];
  openai_settings: LegacyOaiPresetSettings[];
  v2ExperimentalSamplerPreset_names: string[];
  v2ExperimentalSamplerPreset_settings: SamplerSettings[];
  world_names: string[];
}

let cachedResponse: ParsedUserSettingsResponse | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 2000; // 2 seconds cache duration to handle initial load bursts
let fetchPromise: Promise<ParsedUserSettingsResponse> | null = null;

export async function fetchUserSettings(force = false): Promise<ParsedUserSettingsResponse> {
  const now = Date.now();

  if (!force && cachedResponse && now - cacheTimestamp < CACHE_TTL) {
    return cachedResponse;
  }

  // Request coalescing: if a request is already in flight, return the existing promise.
  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = (async () => {
    try {
      const response = await fetch('/api/settings/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({}),
        cache: 'no-cache',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch user settings');
      }

      const data = (await response.json()) as UserSettingsResponse;

      const parsed: ParsedUserSettingsResponse = {
        settings: JSON.parse(data.settings) as LegacySettings,
        openai_setting_names: data.openai_setting_names,
        openai_settings: data.openai_settings.map((s) => JSON.parse(s) as LegacyOaiSettings),
        v2ExperimentalSamplerPreset_names: data.v2ExperimentalSamplerPreset_names ?? [],
        v2ExperimentalSamplerPreset_settings: (data.v2ExperimentalSamplerPreset_settings ?? []).map(
          (s) => JSON.parse(s) as SamplerSettings,
        ),
        world_names: data.world_names,
      };

      cachedResponse = parsed;
      cacheTimestamp = Date.now();

      return parsed;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

export async function saveUserSettings(settings: LegacySettings): Promise<void> {
  await fetch('/api/settings/save', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(settings),
    cache: 'no-cache',
  });

  cachedResponse = null;
}
