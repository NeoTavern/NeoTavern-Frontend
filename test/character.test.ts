import { describe, expect, it } from 'vitest';
import { type Character } from '../src/types';
import { getCharacterDifferences } from '../src/utils/character';

describe('getCharacterDifferences', () => {
  it('should detect top-level changes', () => {
    const oldChar = { name: 'Old', avatar: 'old.png', data: {} } as Character;
    const newChar = { name: 'New', avatar: 'new.png', data: {} } as Character;
    const diff = getCharacterDifferences(oldChar, newChar);
    expect(diff).toEqual({
      name: 'New',
      data: { name: 'New' }, // name maps to data.name
    });
  });

  it('should ignore data fields that are mapped to top-level fields', () => {
    const oldChar = {
      name: 'Char',
      avatar: 'char.png',
      description: 'Old Description',
      data: { description: 'Old Description', other: 'KeepMe' },
    } as unknown as Character;

    const newChar = {
      name: 'Char',
      avatar: 'char.png',
      description: 'New Description',
      data: { description: 'Old Description', other: 'KeepMe' }, // Stale data
    } as unknown as Character;

    const diff = getCharacterDifferences(oldChar, newChar);

    // We expect 'description' change to be picked up.
    // We expect 'data.description' to NOT be picked up as a separate key pointing to the OLD value.
    expect(diff).toEqual({
      description: 'New Description',
      data: { description: 'New Description' }, // Mapping ensures this updates
    });
  });

  it('should verify complex stale data scenario', () => {
    // This replicates the user's scenario
    const oldCharStep2 = {
      name: 'Char',
      avatar: 'char.png',
      description: 'New Description',
      personality: 'Old Personality',
      data: { description: 'New Description', personality: 'Old Personality' },
    } as unknown as Character;

    const newCharStep2 = {
      name: 'Char',
      avatar: 'char.png',
      description: 'New Description', // Unchanged
      personality: 'New Personality',
      data: { description: 'Old Description', personality: 'Old Personality' }, // STALE data.description
    } as unknown as Character;

    const diff2 = getCharacterDifferences(oldCharStep2, newCharStep2);

    expect(diff2).toEqual({
      personality: 'New Personality',
      data: { personality: 'New Personality' },
    });

    // Crucially, it should NOT contain data.description: 'Old Description'
    expect(diff2?.data).not.toHaveProperty('description');
  });

  it('should still detect unmapped data changes', () => {
    const oldChar = { name: 'Char', avatar: 'char.png', data: { custom: 'A' } } as Character;
    const newChar = { name: 'Char', avatar: 'char.png', data: { custom: 'B' } } as Character;

    const diff = getCharacterDifferences(oldChar, newChar);
    expect(diff).toEqual({
      data: { custom: 'B' },
    });
  });
});
