import type { GraphPreset } from '../graph/contracts';
import { compileValidatedGraph } from '../graph/compile';
import { validateGraphPreset } from '../graph/validate';
import { builtinNodeRegistry } from '../registry/builtin-nodes';
import type { CompiledGraphAgent } from '../host/lifecycle';

export type InstalledGraphAgentsSettings = { presets: GraphPreset[] };

export type PreparedInstalledGraphAgents = {
  settings: InstalledGraphAgentsSettings;
  agents: readonly CompiledGraphAgent[];
};

export interface GraphSettingsAPI {
  settings: {
    get(): unknown;
    set(path: undefined, value: InstalledGraphAgentsSettings): void;
    save(): void;
  };
}

const clone = <Value>(value: Value): Value => structuredClone(value);

function objectKeysEqual(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function preparePreset(value: unknown): { preset: GraphPreset; agent: CompiledGraphAgent } {
  const validated = validateGraphPreset(value, builtinNodeRegistry);
  if (!validated.valid)
    throw new Error(validated.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  const preset = clone(validated.value.preset) as GraphPreset;
  return {
    preset,
    agent: Object.freeze({ definition: clone(preset.agent), plan: compileValidatedGraph(validated.value) }),
  };
}

export function prepareInstalledGraphAgentsSettings(value: unknown): PreparedInstalledGraphAgents {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !objectKeysEqual(value as Record<string, unknown>, ['presets'])
  )
    throw new Error('Custom Agents settings must contain exactly presets');
  const presets = (value as { presets?: unknown }).presets;
  if (!Array.isArray(presets)) throw new Error('Custom Agents settings presets must be an array');
  const prepared = presets.map(preparePreset);
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const { preset } of prepared) {
    if (ids.has(preset.agent.id)) throw new Error(`Duplicate agent ID ${preset.agent.id}`);
    if (names.has(preset.agent.name)) throw new Error(`Duplicate agent name ${preset.agent.name}`);
    ids.add(preset.agent.id);
    names.add(preset.agent.name);
  }
  const generationAgents = prepared.filter(
    ({ preset }) =>
      preset.agent.enabled &&
      preset.agent.flows.some(
        (flow) => flow.kind === 'TRIGGER' && flow.nodes.some((node) => node.type === 'trigger.generate-assistant'),
      ),
  );
  if (generationAgents.length > 1)
    throw new Error(
      `Only one enabled generation-capable Custom Agent is allowed: ${generationAgents
        .map(({ preset }) => preset.agent.name)
        .join(', ')}`,
    );
  return {
    settings: { presets: prepared.map(({ preset }) => preset) },
    agents: Object.freeze(prepared.map(({ agent }) => agent)),
  };
}

export function validateInstalledPreset(value: unknown): GraphPreset {
  return preparePreset(value).preset;
}

export function validateInstalledGraphAgentsSettings(value: unknown): InstalledGraphAgentsSettings {
  return prepareInstalledGraphAgentsSettings(value).settings;
}

export function loadPreparedInstalledGraphAgents(api: GraphSettingsAPI): PreparedInstalledGraphAgents {
  return prepareInstalledGraphAgentsSettings(api.settings.get());
}

export function loadInstalledGraphAgents(api: GraphSettingsAPI): InstalledGraphAgentsSettings {
  return loadPreparedInstalledGraphAgents(api).settings;
}

export function persistPreparedInstalledGraphAgents(
  api: GraphSettingsAPI,
  prepared: PreparedInstalledGraphAgents,
): void {
  api.settings.set(undefined, clone(prepared.settings));
  api.settings.save();
}

export function saveInstalledGraphAgents(
  api: GraphSettingsAPI,
  value: InstalledGraphAgentsSettings,
): InstalledGraphAgentsSettings {
  const prepared = prepareInstalledGraphAgentsSettings(value);
  persistPreparedInstalledGraphAgents(api, prepared);
  return prepared.settings;
}

export function emptyInstalledGraphAgents(): InstalledGraphAgentsSettings {
  return { presets: [] };
}
