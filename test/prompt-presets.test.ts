import { describe, expect, it } from 'vitest';
import {
  migratePromptPresetState,
  resolvePromptPreset,
  type PromptPreset,
  type PromptPresetState,
} from '../src/extensions/built-in/prompt-presets';

type TestPrompts = {
  prompt: string;
  secondary: string;
};

const builtIns: PromptPreset<TestPrompts>[] = [
  {
    id: 'default',
    name: 'Default',
    builtIn: true,
    prompts: {
      prompt: 'new default prompt',
      secondary: 'new default secondary',
    },
  },
];

const legacyDefaults: TestPrompts = {
  prompt: 'old default prompt',
  secondary: 'old default secondary',
};

describe('prompt presets', () => {
  it('resolves missing active preset to the built-in default', () => {
    const state: PromptPresetState<TestPrompts> = {
      activePromptPresetId: 'missing',
      promptPresets: [],
    };

    expect(resolvePromptPreset(state, builtIns)).toEqual(builtIns[0]);
  });

  it('does not persist unchanged legacy defaults', () => {
    const migrated = migratePromptPresetState({
      settings: {},
      builtInPresets: builtIns,
      legacyPrompts: legacyDefaults,
      legacyDefaults,
    });

    expect(migrated.activePromptPresetId).toBe('default');
    expect(migrated.promptPresets).toEqual([]);
  });

  it('migrates changed legacy prompts into a user preset', () => {
    const migrated = migratePromptPresetState({
      settings: {},
      builtInPresets: builtIns,
      legacyPrompts: {
        prompt: 'custom prompt',
        secondary: 'old default secondary',
      },
      legacyDefaults,
    });

    expect(migrated.activePromptPresetId).toBe('custom');
    expect(migrated.promptPresets).toHaveLength(1);
    expect(migrated.promptPresets?.[0]).toMatchObject({
      id: 'custom',
      name: 'Custom',
      prompts: {
        prompt: 'custom prompt',
        secondary: 'old default secondary',
      },
    });
  });

  it('keeps migrated state stable after the first migration', () => {
    const migrated = migratePromptPresetState({
      settings: {
        activePromptPresetId: 'custom',
        promptPresetMigrationVersion: 1,
        promptPresets: [
          {
            id: 'custom',
            name: 'Custom',
            prompts: {
              prompt: 'custom prompt',
              secondary: 'custom secondary',
            },
          },
        ],
      },
      builtInPresets: builtIns,
      legacyPrompts: {
        prompt: 'different ignored legacy prompt',
      },
      legacyDefaults,
    });

    expect(resolvePromptPreset(migrated, builtIns).prompts.prompt).toBe('custom prompt');
    expect(migrated.promptPresets).toHaveLength(1);
  });
});
