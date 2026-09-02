import type { GraphPreset } from '../graph/contracts';
import { parseGraphPresetShape } from '../graph/schemas';
import { compileGraphPreset } from '../graph/compile';
import { builtinNodeRegistry } from '../registry/builtin-nodes';

export type InstalledGraphAgentsSettings = { presets: GraphPreset[] };

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

export function validateInstalledPreset(value: unknown): GraphPreset {
  const parsed = parseGraphPresetShape(value);
  if (!parsed.success)
    throw new Error(parsed.issues.map((issue) => `${issue.path.join('.') || 'preset'}: ${issue.message}`).join('\n'));
  const compiled = compileGraphPreset(parsed.value, builtinNodeRegistry);
  if (!compiled.success)
    throw new Error(compiled.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  return clone(parsed.value);
}

export function validateInstalledGraphAgentsSettings(value: unknown): InstalledGraphAgentsSettings {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !objectKeysEqual(value as Record<string, unknown>, ['presets'])
  )
    throw new Error('Custom Agents settings must contain exactly presets');
  const presets = (value as { presets?: unknown }).presets;
  if (!Array.isArray(presets)) throw new Error('Custom Agents settings presets must be an array');
  const validated = presets.map(validateInstalledPreset);
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const preset of validated) {
    if (ids.has(preset.agent.id)) throw new Error(`Duplicate agent ID ${preset.agent.id}`);
    if (names.has(preset.agent.name)) throw new Error(`Duplicate agent name ${preset.agent.name}`);
    ids.add(preset.agent.id);
    names.add(preset.agent.name);
  }
  const generationAgents = validated.filter(
    (preset) =>
      preset.agent.enabled &&
      preset.agent.flows.some(
        (flow) => flow.kind === 'TRIGGER' && flow.nodes.some((node) => node.type === 'trigger.generate-assistant'),
      ),
  );
  if (generationAgents.length > 1)
    throw new Error(
      `Only one enabled generation-capable Custom Agent is allowed: ${generationAgents
        .map((preset) => preset.agent.name)
        .join(', ')}`,
    );
  return { presets: validated };
}

export function loadInstalledGraphAgents(api: GraphSettingsAPI): InstalledGraphAgentsSettings {
  return validateInstalledGraphAgentsSettings(api.settings.get());
}

export function saveInstalledGraphAgents(
  api: GraphSettingsAPI,
  value: InstalledGraphAgentsSettings,
): InstalledGraphAgentsSettings {
  const validated = validateInstalledGraphAgentsSettings(value);
  api.settings.set(undefined, clone(validated));
  api.settings.save();
  return validated;
}

export function emptyInstalledGraphAgents(): InstalledGraphAgentsSettings {
  return { presets: [] };
}
