import type { InstalledGraphAgentsSettings } from './store';
import { addInstalledPreset } from './management';
import { validateInstalledGraphAgentsSettings, validateInstalledPreset } from './store';

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
): InstalledGraphAgentsSettings {
  let payload: unknown;
  try {
    payload = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid preset JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const preset = validateInstalledPreset(payload);
  if (settings.presets.some((candidate) => candidate.agent.id === preset.agent.id))
    throw new Error(`Duplicate agent ID ${preset.agent.id}`);
  if (settings.presets.some((candidate) => candidate.agent.name === preset.agent.name))
    throw new Error(`Duplicate agent name ${preset.agent.name}`);
  return addInstalledPreset(settings, preset);
}
