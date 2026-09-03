import { GRAPH_PRESET_FORMAT, type GraphPreset } from '../graph/contracts';
import type { InstalledGraphAgentsSettings, PreparedInstalledGraphAgents } from './store';
import { prepareInstalledGraphAgentsSettings } from './store';

const clone = <Value>(value: Value): Value => structuredClone(value);

function assertAvailable(settings: InstalledGraphAgentsSettings, id: string, name: string, exceptId?: string): void {
  if (settings.presets.some((preset) => preset.agent.id === id && preset.agent.id !== exceptId))
    throw new Error(`Duplicate agent ID ${id}`);
  if (settings.presets.some((preset) => preset.agent.name === name && preset.agent.id !== exceptId))
    throw new Error(`Duplicate agent name ${name}`);
}

export function createGraphPreset(id: string, name: string): GraphPreset {
  return {
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
  };
}

export function addInstalledPreset(
  settings: InstalledGraphAgentsSettings,
  preset: GraphPreset,
): PreparedInstalledGraphAgents {
  assertAvailable(settings, preset.agent.id, preset.agent.name);
  return prepareInstalledGraphAgentsSettings({ presets: [...settings.presets, preset] });
}

export function replaceInstalledPreset(
  settings: InstalledGraphAgentsSettings,
  originalId: string,
  preset: GraphPreset,
): PreparedInstalledGraphAgents {
  const index = settings.presets.findIndex((candidate) => candidate.agent.id === originalId);
  if (index < 0) throw new Error(`Unknown agent ${originalId}`);
  if (preset.agent.id !== originalId) throw new Error('Agent IDs are stable and cannot be changed');
  assertAvailable(settings, preset.agent.id, preset.agent.name, originalId);
  const presets = clone(settings.presets);
  presets[index] = preset;
  return prepareInstalledGraphAgentsSettings({ presets });
}

export function duplicateInstalledPreset(
  settings: InstalledGraphAgentsSettings,
  sourceId: string,
  id: string,
  name: string,
): PreparedInstalledGraphAgents {
  const source = settings.presets.find((preset) => preset.agent.id === sourceId);
  if (!source) throw new Error(`Unknown agent ${sourceId}`);
  assertAvailable(settings, id, name);
  const copy = clone(source);
  copy.agent.id = id;
  copy.agent.name = name;
  copy.agent.enabled = false;
  return prepareInstalledGraphAgentsSettings({ presets: [...settings.presets, copy] });
}

export function renameInstalledPreset(
  settings: InstalledGraphAgentsSettings,
  id: string,
  name: string,
): PreparedInstalledGraphAgents {
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
): PreparedInstalledGraphAgents {
  const preset = settings.presets.find((candidate) => candidate.agent.id === id);
  if (!preset) throw new Error(`Unknown agent ${id}`);
  const next = clone(preset);
  next.agent.enabled = enabled;
  return replaceInstalledPreset(settings, id, next);
}

export function deleteInstalledPreset(
  settings: InstalledGraphAgentsSettings,
  id: string,
): PreparedInstalledGraphAgents {
  if (!settings.presets.some((preset) => preset.agent.id === id)) throw new Error(`Unknown agent ${id}`);
  return prepareInstalledGraphAgentsSettings({ presets: settings.presets.filter((preset) => preset.agent.id !== id) });
}

/** Catalog definitions remain immutable; installation prepares a strict disabled collection candidate. */
export function installGraphTemplate(
  settings: InstalledGraphAgentsSettings,
  template: GraphPreset,
): PreparedInstalledGraphAgents {
  const copy = clone(template);
  copy.agent.enabled = false;
  assertAvailable(settings, copy.agent.id, copy.agent.name);
  return prepareInstalledGraphAgentsSettings({ presets: [...settings.presets, copy] });
}
