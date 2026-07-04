export interface PromptPreset<TPrompts extends Record<string, string>> {
  id: string;
  name: string;
  prompts: TPrompts;
  builtIn?: boolean;
}

export interface PromptPresetState<TPrompts extends Record<string, string>> {
  activePromptPresetId?: string;
  promptPresets?: PromptPreset<TPrompts>[];
  promptPresetMigrationVersion?: number;
}

interface MigratePromptPresetStateOptions<TPrompts extends Record<string, string>> {
  settings: PromptPresetState<TPrompts>;
  builtInPresets: PromptPreset<TPrompts>[];
  legacyPrompts: Partial<TPrompts>;
  legacyDefaults: TPrompts;
  customPresetName?: string;
}

const PROMPT_PRESET_MIGRATION_VERSION = 1;

function isUserPreset<TPrompts extends Record<string, string>>(preset: PromptPreset<TPrompts>): boolean {
  return !preset.builtIn;
}

function uniquePresetId<TPrompts extends Record<string, string>>(
  baseId: string,
  presets: PromptPreset<TPrompts>[],
): string {
  const ids = new Set(presets.map((preset) => preset.id));
  if (!ids.has(baseId)) return baseId;

  let index = 2;
  while (ids.has(`${baseId}-${index}`)) index++;
  return `${baseId}-${index}`;
}

export function getPromptPresetOptions<TPrompts extends Record<string, string>>(
  builtInPresets: PromptPreset<TPrompts>[],
  userPresets: PromptPreset<TPrompts>[] = [],
): Array<{ label: string; value: string }> {
  return [...builtInPresets, ...userPresets].map((preset) => ({
    label: preset.builtIn && preset.name.toLowerCase() !== 'default' ? `${preset.name} (Default)` : preset.name,
    value: preset.id,
  }));
}

export function getAllPromptPresets<TPrompts extends Record<string, string>>(
  builtInPresets: PromptPreset<TPrompts>[],
  userPresets: PromptPreset<TPrompts>[] = [],
): PromptPreset<TPrompts>[] {
  return [...builtInPresets, ...userPresets.filter(isUserPreset)];
}

export function resolvePromptPreset<TPrompts extends Record<string, string>>(
  state: PromptPresetState<TPrompts>,
  builtInPresets: PromptPreset<TPrompts>[],
): PromptPreset<TPrompts> {
  const allPresets = getAllPromptPresets(builtInPresets, state.promptPresets);
  return allPresets.find((preset) => preset.id === state.activePromptPresetId) ?? builtInPresets[0];
}

export function duplicatePromptPreset<TPrompts extends Record<string, string>>(
  source: PromptPreset<TPrompts>,
  existingPresets: PromptPreset<TPrompts>[],
  name: string,
): PromptPreset<TPrompts> {
  return {
    id: uniquePresetId(
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-') || 'custom',
      existingPresets,
    ),
    name,
    prompts: { ...source.prompts },
  };
}

export function migratePromptPresetState<TPrompts extends Record<string, string>>({
  settings,
  builtInPresets,
  legacyPrompts,
  legacyDefaults,
  customPresetName = 'Custom',
}: MigratePromptPresetStateOptions<TPrompts>): PromptPresetState<TPrompts> {
  const userPresets = (settings.promptPresets ?? []).filter(isUserPreset);
  const defaultPreset = builtInPresets[0];

  if (settings.promptPresetMigrationVersion === PROMPT_PRESET_MIGRATION_VERSION) {
    return {
      ...settings,
      activePromptPresetId: resolvePromptPreset({ ...settings, promptPresets: userPresets }, builtInPresets).id,
      promptPresets: userPresets,
      promptPresetMigrationVersion: PROMPT_PRESET_MIGRATION_VERSION,
    };
  }

  const legacyChanged = Object.entries(legacyDefaults).some(([key, defaultValue]) => {
    const legacyValue = legacyPrompts[key as keyof TPrompts];
    return typeof legacyValue === 'string' && legacyValue !== defaultValue;
  });

  if (!legacyChanged) {
    return {
      ...settings,
      activePromptPresetId: defaultPreset.id,
      promptPresets: userPresets,
      promptPresetMigrationVersion: PROMPT_PRESET_MIGRATION_VERSION,
    };
  }

  const customPreset = duplicatePromptPreset(
    {
      ...defaultPreset,
      prompts: Object.fromEntries(
        Object.entries(defaultPreset.prompts).map(([key, value]) => [
          key,
          legacyPrompts[key as keyof TPrompts] ?? value,
        ]),
      ) as TPrompts,
    },
    [...builtInPresets, ...userPresets],
    customPresetName,
  );

  return {
    ...settings,
    activePromptPresetId: customPreset.id,
    promptPresets: [...userPresets, customPreset],
    promptPresetMigrationVersion: PROMPT_PRESET_MIGRATION_VERSION,
  };
}
