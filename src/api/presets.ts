import { defaultSamplerSettings } from '../constants';
import type { LegacyOaiPresetSettings, SamplerSettings } from '../types';
import { getRequestHeaders } from '../utils/api';
import { fetchUserSettings } from './settings';

export interface Preset {
  name: string;
  preset: SamplerSettings;
}

export function migratePreset(legacyPreset: LegacyOaiPresetSettings): SamplerSettings {
  const newPreset: SamplerSettings = {
    temperature: legacyPreset.temperature ?? defaultSamplerSettings.temperature,
    frequency_penalty: legacyPreset.frequency_penalty ?? defaultSamplerSettings.frequency_penalty,
    presence_penalty: legacyPreset.presence_penalty ?? defaultSamplerSettings.presence_penalty,
    repetition_penalty: legacyPreset.repetition_penalty ?? defaultSamplerSettings.repetition_penalty,
    top_p: legacyPreset.top_p ?? defaultSamplerSettings.top_p,
    top_k: legacyPreset.top_k ?? defaultSamplerSettings.top_k,
    top_a: legacyPreset.top_a ?? defaultSamplerSettings.top_a,
    min_p: legacyPreset.min_p ?? defaultSamplerSettings.min_p,
    max_context_unlocked: legacyPreset.max_context_unlocked ?? defaultSamplerSettings.max_context_unlocked,
    max_context: legacyPreset.openai_max_context ?? defaultSamplerSettings.max_context,
    max_tokens: legacyPreset.openai_max_tokens ?? defaultSamplerSettings.max_tokens,
    stream: legacyPreset.stream_openai ?? defaultSamplerSettings.stream,
    prompts: legacyPreset.prompts ?? defaultSamplerSettings.prompts,
    prompt_order:
      legacyPreset.prompt_order !== undefined
        ? { order: legacyPreset.prompt_order?.[0]?.order ?? [] }
        : defaultSamplerSettings.prompt_order,
    seed: legacyPreset.seed ?? defaultSamplerSettings.seed,
    n: legacyPreset.n ?? defaultSamplerSettings.n,
    stop: defaultSamplerSettings.stop, // Legacy don't have it, I'm not sure what to do here
    providers: {
      claude: {
        use_sysprompt: legacyPreset.claude_use_sysprompt,
        assistant_prefill: legacyPreset.assistant_prefill,
      },
      google: {
        use_makersuite_sysprompt: legacyPreset.use_makersuite_sysprompt,
      },
    },
    show_thoughts: legacyPreset.show_thoughts ?? defaultSamplerSettings.show_thoughts,
    reasoning_effort: legacyPreset.reasoning_effort ?? defaultSamplerSettings.reasoning_effort ?? 'auto',
  };

  return newPreset;
}

export async function fetchAllExperimentalPresets(): Promise<Preset[]> {
  const userSettingsResponse = await fetchUserSettings();

  const presets: Preset[] = [];
  const names = userSettingsResponse.v2ExperimentalSamplerPreset_names ?? [];
  const settingsData = userSettingsResponse.v2ExperimentalSamplerPreset_settings ?? [];

  if (Array.isArray(names) && Array.isArray(settingsData)) {
    names.forEach((name: string, i: number) => {
      try {
        presets.push({
          name,
          preset: settingsData[i],
        });
      } catch (e) {
        console.error(`Failed to parse preset "${name}":`, settingsData[i]);
      }
    });
  }

  return presets;
}

export async function saveExperimentalPreset(name: string, preset: SamplerSettings): Promise<any> {
  const response = await fetch('/api/presets/save', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({
      apiId: 'v2ExperimentalSamplerPreset',
      name,
      preset,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to save preset');
  }

  return await response.json();
}

export async function deletePreset(name: string): Promise<any> {
  const response = await fetch('/api/presets/delete', {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify({ apiId: 'v2ExperimentalSamplerPreset', name }),
  });

  if (!response.ok) {
    throw new Error('Failed to delete preset');
  }

  return await response.json();
}
