import type { LegacyOaiPresetSettings, LegacyOaiSettings, LegacySettings, ReasoningTemplate, Settings } from '../types';
import type { InstructTemplate } from '../types/instruct';
import { getRequestHeaders } from '../utils/client';

export interface UserSettingsResponse {
  settings: string; // JSON string of LegacySettings
  openai_setting_names: string[];
  openai_settings: string[]; // JSON string of LegacyOaiPresetSettings
  world_names: string[];
  instruct: InstructTemplate[];
  reasoning: ReasoningTemplate[];
}

export interface ParsedUserSettingsResponse {
  settings: LegacySettings;
  openai_setting_names: string[];
  openai_settings: LegacyOaiPresetSettings[];
  world_names: string[];
  instruct: InstructTemplate[];
  reasoning: ReasoningTemplate[];
}

let cachedResponse: ParsedUserSettingsResponse | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 2000; // 2 seconds cache duration to handle initial load bursts
let fetchPromise: Promise<ParsedUserSettingsResponse> | null = null;

let cachedNeoResponse: Settings | null = null;
let neoCacheTimestamp = 0;
let neoFetchPromise: Promise<Settings> | null = null;

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
        world_names: data.world_names,
        instruct: data.instruct,
        reasoning: data.reasoning ?? [],
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

export async function fetchNeoSettings(force = false): Promise<Settings> {
  const now = Date.now();

  if (!force && cachedNeoResponse && now - neoCacheTimestamp < CACHE_TTL) {
    return cachedNeoResponse;
  }

  if (neoFetchPromise) {
    return neoFetchPromise;
  }

  neoFetchPromise = (async () => {
    try {
      const response = await fetch('/api/plugins/neo/settings', {
        method: 'GET',
        headers: getRequestHeaders(),
        cache: 'no-cache',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch Neo user settings: ${response.statusText}`);
      }

      const data = (await response.json()) as Settings;

      cachedNeoResponse = data;
      neoCacheTimestamp = Date.now();

      return data;
    } finally {
      neoFetchPromise = null;
    }
  })();

  return neoFetchPromise;
}

export async function saveNeoSettings(settings: Settings): Promise<void> {
  await fetch('/api/plugins/neo/settings', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(settings),
    cache: 'no-cache',
  });

  cachedNeoResponse = null;
  neoCacheTimestamp = 0;
}
