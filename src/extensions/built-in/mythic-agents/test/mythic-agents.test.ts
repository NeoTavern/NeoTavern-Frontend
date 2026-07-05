import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_SETTINGS, DEFAULT_FATE_CHART_DATA, migrateMythicSettings } from '../defaults';
import { generateFullRandomEvent } from '../event-generator';
import { rollFate } from '../oracle';

function withMockedRandom<T>(values: number[], callback: () => T): T {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => values[index++] ?? values[values.length - 1] ?? 0;

  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

describe('Mythic Agents Oracle', () => {
  it('should roll fate correctly for high odds', () => {
    const scene = { chaos_rank: 5, characters: [], threads: [] };
    const eventGenerationData = { focuses: [], actions: [], subjects: [] };
    const uneSettings = { modifiers: [], nouns: [], motivation_verbs: [], motivation_nouns: [] };

    // Mock Math.random to return 0.5 for d10 (5)
    const originalRandom = Math.random;
    Math.random = () => 0.4; // d10 = Math.floor(0.4*10)+1 = 4+1=5

    try {
      const result = rollFate('Very Likely', 5, DEFAULT_FATE_CHART_DATA, scene, eventGenerationData, uneSettings);
      expect(result.fateRollResult.roll).toBe(10); // 5+5
      expect(result.fateRollResult.outcome).toBe('Exceptional Yes'); // For Very Likely at chaos 5, exceptional_yes 19, 10 <=19
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should handle case insensitive odds', () => {
    const scene = { chaos_rank: 5, characters: [], threads: [] };
    const eventGenerationData = { focuses: [], actions: [], subjects: [] };
    const uneSettings = { modifiers: [], nouns: [], motivation_verbs: [], motivation_nouns: [] };

    const originalRandom = Math.random;
    Math.random = () => 0.4;

    try {
      const result = rollFate('A Sure Thing', 4, DEFAULT_FATE_CHART_DATA, scene, eventGenerationData, uneSettings);
      expect(result.fateRollResult.outcome).toBeDefined();
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should generate full random event with new NPC', () => {
    const scene = { chaos_rank: 5, characters: [], threads: [] };
    const eventGenerationData = {
      focuses: [{ min: 1, max: 100, focus: 'Test Focus', action: 'new_warrior' }],
      actions: ['action1'],
      subjects: ['subject1'],
    };
    const uneSettings = {
      modifiers: ['Brave'],
      nouns: ['Warrior'],
      motivation_verbs: ['to protect'],
      motivation_nouns: ['the village'],
    };

    const result = withMockedRandom(
      [
        0.49, // Focus roll: 50
        0, // Action index: 0
        0, // Subject index: 0
      ],
      () => generateFullRandomEvent(scene, eventGenerationData, uneSettings),
    );
    expect(result.focus).toBe('Test Focus');
    expect(result.action).toBe('action1');
    expect(result.subject).toBe('subject1');
    expect(result.new_npcs).toHaveLength(1);
    expect(result.new_npcs![0].type).toBe('warrior');
    expect(result.new_npcs![0].name).toBe('Brave Warrior');
  });

  it('should parse complex action string with jsep', () => {
    const scene = {
      chaos_rank: 5,
      characters: [
        {
          id: '1',
          name: 'Alice',
          type: 'PC',
          une_profile: { modifier: '', noun: '', motivation_verb: '', motivation_noun: '' },
        },
        {
          id: '2',
          name: 'Bob',
          type: 'NPC',
          une_profile: { modifier: '', noun: '', motivation_verb: '', motivation_noun: '' },
        },
      ],
      threads: ['thread1', 'thread2'],
    };
    const eventGenerationData = {
      focuses: [{ min: 1, max: 100, focus: 'Complex Focus', action: '(random_pc or random_npc) and random_thread' }],
      actions: ['action1'],
      subjects: ['subject1'],
    };
    const uneSettings = {
      modifiers: ['Brave'],
      nouns: ['Warrior'],
      motivation_verbs: ['to protect'],
      motivation_nouns: ['the village'],
    };

    const result = withMockedRandom(
      [
        0.49, // Focus roll: 50
        0, // Action index: 0
        0, // Subject index: 0
        0, // 'or' choice: left branch (random_pc)
        0, // Random PC index: 0
        0, // Random thread index: 0
      ],
      () => generateFullRandomEvent(scene, eventGenerationData, uneSettings),
    );
    expect(result.focus).toBe('Complex Focus');
    expect(result.characters).toHaveLength(1);
    expect(result.characters![0].name).toBe('Alice');
    expect(result.threads).toHaveLength(1);
    expect(result.threads![0]).toBe('thread1');
  });
});

describe('Mythic Agents settings migration', () => {
  it('keeps the built-in default preset read-only', () => {
    const migrated = migrateMythicSettings();

    expect(migrated.selectedPreset).toBe('Default');
    expect(migrated.presets[0]).toMatchObject({
      name: 'Default',
      builtIn: true,
    });
  });

  it('moves a modified legacy default preset into a custom preset', () => {
    const saved = JSON.parse(JSON.stringify(DEFAULT_BASE_SETTINGS));
    saved.presets[0].data.characterTypes = ['NPC', 'Companion'];

    const migrated = migrateMythicSettings(saved);

    expect(migrated.presets[0].builtIn).toBe(true);
    expect(migrated.presets[0].data.characterTypes).toEqual(['NPC', 'PC']);
    expect(migrated.selectedPreset).toBe('Default Copy');
    expect(migrated.presets.find((preset) => preset.name === 'Default Copy')).toMatchObject({
      builtIn: false,
      data: {
        characterTypes: ['NPC', 'Companion'],
      },
    });
  });
});
