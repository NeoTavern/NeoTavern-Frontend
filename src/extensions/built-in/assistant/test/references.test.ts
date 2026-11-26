import { describe, expect, test } from 'vitest';
import { expandCommand, parseMessageRef, renderReferencedBlock, suggestAt } from '../references';
import { entry, fakeDataApi } from '../test-support/fake-data-api';
import { DEFAULT_COMMANDS } from '../types';

describe('references', () => {
  test('#last5 on a 3-message chat covers 0..2', () => {
    expect(parseMessageRef('last5', 3)).toEqual({ kind: 'messages', from: 0, to: 2, label: '#last5' });
    expect(parseMessageRef('3', 3)).toBeNull();
  });

  test('@ matches character and lorebook names case-insensitively', () => {
    const refs = suggestAt('EL', {
      characters: [
        { avatar: 'hazel.png', name: 'Hazel' },
        { avatar: 'mira.png', name: 'Mira' },
      ],
      personas: [],
      books: ['Eldoria', 'Ashlands'],
      entries: [],
    });

    expect(refs.map((ref) => ref.label)).toEqual(['Hazel', 'Eldoria']);
  });

  test('the [Referenced] block inlines current content in the read-tool shapes', async () => {
    const api = fakeDataApi({
      history: [
        { name: 'Hazel', is_user: false, mes: 'first' },
        { name: 'Alex', is_user: true, mes: '{{char}} waves' },
      ],
      books: [{ name: 'Eldoria', entries: [entry(4, { comment: 'Castle', content: 'A ruin.' })] }],
    });

    const block = await renderReferencedBlock(api, [
      { kind: 'entry', book: 'Eldoria', uid: 4, label: 'Eldoria/Castle' },
      { kind: 'messages', from: 1, to: 1, label: '#1' },
    ]);

    expect(block.startsWith('[Referenced]')).toBe(true);
    expect(block).toContain('"content": "A ruin."');
    expect(block).toContain('"mes": "{{char}} waves"');
    expect(block).not.toContain('first');
  });

  test('a leading /command expands to its prompt ahead of the rest of the text', () => {
    expect(expandCommand('/grammar keep it British', DEFAULT_COMMANDS)).toBe(
      `${DEFAULT_COMMANDS[0].prompt}\n\nkeep it British`,
    );
    expect(expandCommand('/unknown text', DEFAULT_COMMANDS)).toBe('/unknown text');
  });
});
