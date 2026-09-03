import type { InstalledGraphAgentsSettings, PreparedInstalledGraphAgents } from './store';
import { prepareInstalledGraphAgentsSettings, validateInstalledGraphAgentsSettings } from './store';

export function exportGraphPreset(settings: InstalledGraphAgentsSettings, id: string): string {
  const validated = validateInstalledGraphAgentsSettings(settings);
  const preset = validated.presets.find((candidate) => candidate.agent.id === id);
  if (!preset) throw new Error(`Unknown agent ${id}`);
  return JSON.stringify(preset, null, 2);
}

/** Parses and validates the complete payload before checking or mutating installed definitions. */
export function importGraphPreset(
  settings: InstalledGraphAgentsSettings,
  source: string,
): PreparedInstalledGraphAgents {
  let payload: unknown;
  try {
    payload = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid preset JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return prepareInstalledGraphAgentsSettings({ presets: [...settings.presets, payload] });
}
