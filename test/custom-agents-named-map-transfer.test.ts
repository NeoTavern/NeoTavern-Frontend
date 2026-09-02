import { describe, expect, it } from 'vitest';
import mythic from '../src/extensions/built-in/custom-agents/presets/mythic.flow.json';
import {
  NAMED_MAP_BUNDLE_FORMAT,
  NAMED_MAP_SINGLE_FORMAT,
  bundleNamedMapTransfer,
  namedMapFilename,
  parseNamedMapTransfer,
  singleNamedMapTransfer,
} from '../src/extensions/built-in/custom-agents/settings/named-map-transfer';

describe('custom agent named-map portable envelopes', () => {
  it('exports exact single and ordered bundle values with distinct stable formats', () => {
    const value = { rows: [{ minimum: 1, maximum: 2 }], nested: { exact: true } };
    expect(singleNamedMapTransfer('First', value)).toEqual({
      format: NAMED_MAP_SINGLE_FORMAT,
      collection: { name: 'First', value },
    });
    expect(bundleNamedMapTransfer({ First: value, Second: { rows: [] } })).toEqual({
      format: NAMED_MAP_BUNDLE_FORMAT,
      collections: [
        { name: 'First', value },
        { name: 'Second', value: { rows: [] } },
      ],
    });
  });

  it('strictly rejects wrong formats, extra shape, unsafe or unnormalized names, and file-local duplicates', () => {
    const single = JSON.stringify(singleNamedMapTransfer('First', { exact: true }));
    expect(parseNamedMapTransfer(single, 'single')).toEqual([{ name: 'First', value: { exact: true } }]);
    expect(() => parseNamedMapTransfer(single, 'bundle')).toThrow(/not a collection-bundle/);
    expect(() =>
      parseNamedMapTransfer(JSON.stringify({ ...singleNamedMapTransfer('First', {}), extra: true }), 'single'),
    ).toThrow(/single-collection envelope/);
    expect(() =>
      parseNamedMapTransfer(
        JSON.stringify({ format: NAMED_MAP_SINGLE_FORMAT, collection: { name: ' First ', value: {} } }),
        'single',
      ),
    ).toThrow(/normalized/);
    expect(() =>
      parseNamedMapTransfer(
        JSON.stringify({
          format: NAMED_MAP_BUNDLE_FORMAT,
          collections: [
            { name: 'Repeated', value: {} },
            { name: 'Repeated', value: { other: true } },
          ],
        }),
        'bundle',
      ),
    ).toThrow(/Duplicate collection name/);
  });

  it('round-trips Mythic active and all named table collections byte-exactly', () => {
    const maps = mythic.agent.configurationDefaults.tableCollections;
    const active = mythic.agent.configurationDefaults.activeTableCollection;
    const single = singleNamedMapTransfer(active, maps[active as keyof typeof maps]);
    expect(parseNamedMapTransfer(JSON.stringify(single), 'single')).toEqual([
      { name: active, value: maps[active as keyof typeof maps] },
    ]);
    const bundle = bundleNamedMapTransfer(maps);
    expect(parseNamedMapTransfer(JSON.stringify(bundle), 'bundle')).toEqual(
      Object.entries(maps).map(([name, value]) => ({ name, value })),
    );
  });

  it('creates useful sanitized filenames', () => {
    expect(namedMapFilename('Agent / One', 'table:collections', 'A * B')).toBe('Agent-One-table-collections-A-B.json');
    expect(namedMapFilename('...')).toBe('collections.json');
  });
});
