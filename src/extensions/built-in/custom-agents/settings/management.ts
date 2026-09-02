import { GRAPH_PRESET_FORMAT, type GraphPreset } from '../graph/contracts';
import type { InstalledGraphAgentsSettings } from './store';
import { validateInstalledGraphAgentsSettings, validateInstalledPreset } from './store';

const clone = <Value>(value: Value): Value => structuredClone(value);

function assertAvailable(settings: InstalledGraphAgentsSettings, id: string, name: string, exceptId?: string): void {
  if (settings.presets.some((preset) => preset.agent.id === id && preset.agent.id !== exceptId))
    throw new Error(`Duplicate agent ID ${id}`);
  if (settings.presets.some((preset) => preset.agent.name === name && preset.agent.id !== exceptId))
    throw new Error(`Duplicate agent name ${name}`);
}

export function createGraphPreset(id: string, name: string): GraphPreset {
  return validateInstalledPreset({
    format: GRAPH_PRESET_FORMAT,
    agent: {
      id,
      name,
      enabled: false,
      priority: 100,
      configurationSchema: { type: 'object', properties: {}, additionalProperties: false },
      configurationDefaults: {},
      stateSchema: { type: 'object', properties: {}, additionalProperties: false },
      initialState: {},
      flows: [],
      views: [],
    },
  });
}

export function addInstalledPreset(
  settings: InstalledGraphAgentsSettings,
  preset: GraphPreset,
): InstalledGraphAgentsSettings {
  const validated = validateInstalledPreset(preset);
  assertAvailable(settings, validated.agent.id, validated.agent.name);
  return validateInstalledGraphAgentsSettings({ presets: [...settings.presets, validated] });
}

export function replaceInstalledPreset(
  settings: InstalledGraphAgentsSettings,
  originalId: string,
  preset: GraphPreset,
): InstalledGraphAgentsSettings {
  const index = settings.presets.findIndex((candidate) => candidate.agent.id === originalId);
  if (index < 0) throw new Error(`Unknown agent ${originalId}`);
  const validated = validateInstalledPreset(preset);
  if (validated.agent.id !== originalId) throw new Error('Agent IDs are stable and cannot be changed');
  assertAvailable(settings, validated.agent.id, validated.agent.name, originalId);
  const presets = clone(settings.presets);
  presets[index] = validated;
  return validateInstalledGraphAgentsSettings({ presets });
}

export function duplicateInstalledPreset(
  settings: InstalledGraphAgentsSettings,
  sourceId: string,
  id: string,
  name: string,
): InstalledGraphAgentsSettings {
  const source = settings.presets.find((preset) => preset.agent.id === sourceId);
  if (!source) throw new Error(`Unknown agent ${sourceId}`);
  const copy = clone(source);
  copy.agent.id = id;
  copy.agent.name = name;
  copy.agent.enabled = false;
  return addInstalledPreset(settings, copy);
}

export function renameInstalledPreset(
  settings: InstalledGraphAgentsSettings,
  id: string,
  name: string,
): InstalledGraphAgentsSettings {
  const preset = settings.presets.find((candidate) => candidate.agent.id === id);
  if (!preset) throw new Error(`Unknown agent ${id}`);
  const next = clone(preset);
  next.agent.name = name;
  return replaceInstalledPreset(settings, id, next);
}

export function setInstalledPresetEnabled(
  settings: InstalledGraphAgentsSettings,
  id: string,
  enabled: boolean,
): InstalledGraphAgentsSettings {
  const preset = settings.presets.find((candidate) => candidate.agent.id === id);
  if (!preset) throw new Error(`Unknown agent ${id}`);
  const next = clone(preset);
  next.agent.enabled = enabled;
  return replaceInstalledPreset(settings, id, next);
}

export function deleteInstalledPreset(
  settings: InstalledGraphAgentsSettings,
  id: string,
): InstalledGraphAgentsSettings {
  if (!settings.presets.some((preset) => preset.agent.id === id)) throw new Error(`Unknown agent ${id}`);
  return validateInstalledGraphAgentsSettings({
    presets: settings.presets.filter((preset) => preset.agent.id !== id),
  });
}

/** Catalog definitions remain immutable; installation always validates and clones a disabled copy. */
export function installGraphTemplate(
  settings: InstalledGraphAgentsSettings,
  template: GraphPreset,
): InstalledGraphAgentsSettings {
  const copy = validateInstalledPreset(clone(template));
  copy.agent.enabled = false;
  return addInstalledPreset(settings, copy);
}
