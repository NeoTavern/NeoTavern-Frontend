import { isJsonValue, type JsonObject, type JsonValue } from '../generic/json';
import { normalizedNamedMapName } from './configuration-controls';

export const NAMED_MAP_SINGLE_FORMAT = 'NEOTAVERN_CUSTOM_AGENT_NAMED_MAP_COLLECTION';
export const NAMED_MAP_BUNDLE_FORMAT = 'NEOTAVERN_CUSTOM_AGENT_NAMED_MAP_COLLECTIONS';

export interface NamedMapTransferEntry {
  name: string;
  value: JsonValue;
}

export type NamedMapTransfer =
  | { format: typeof NAMED_MAP_SINGLE_FORMAT; collection: NamedMapTransferEntry }
  | { format: typeof NAMED_MAP_BUNDLE_FORMAT; collections: NamedMapTransferEntry[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function parseEntry(value: unknown): NamedMapTransferEntry {
  if (!isRecord(value) || !hasExactKeys(value, ['name', 'value'])) throw new Error('Invalid collection entry.');
  if (typeof value.name !== 'string' || normalizedNamedMapName(value.name) !== value.name)
    throw new Error('Collection names must be non-empty, normalized, and safe.');
  if (!isJsonValue(value.value)) throw new Error(`Collection "${value.name}" does not contain a JSON value.`);
  return { name: value.name, value: structuredClone(value.value) };
}

export function singleNamedMapTransfer(name: string, value: JsonValue): NamedMapTransfer {
  return { format: NAMED_MAP_SINGLE_FORMAT, collection: { name, value: structuredClone(value) } };
}

export function bundleNamedMapTransfer(map: JsonObject): NamedMapTransfer {
  return {
    format: NAMED_MAP_BUNDLE_FORMAT,
    collections: Object.entries(map).map(([name, value]) => ({ name, value: structuredClone(value) })),
  };
}

export function parseNamedMapTransfer(text: string, expected: 'single' | 'bundle'): NamedMapTransferEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  if (!isRecord(raw)) throw new Error('Invalid collection import envelope.');

  let entries: NamedMapTransferEntry[];
  if (expected === 'single') {
    if (!hasExactKeys(raw, ['format', 'collection']) || raw.format !== NAMED_MAP_SINGLE_FORMAT)
      throw new Error('The selected file is not a single-collection envelope.');
    entries = [parseEntry(raw.collection)];
  } else {
    if (!hasExactKeys(raw, ['format', 'collections']) || raw.format !== NAMED_MAP_BUNDLE_FORMAT)
      throw new Error('The selected file is not a collection-bundle envelope.');
    if (!Array.isArray(raw.collections) || raw.collections.length === 0)
      throw new Error('A collection bundle must contain at least one collection.');
    entries = raw.collections.map(parseEntry);
  }

  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error(`Duplicate collection name in file: ${entry.name}`);
    names.add(entry.name);
  }
  return entries;
}

export function namedMapFilename(...parts: string[]): string {
  const stem = parts
    .map((part) =>
      part
        .trim()
        .replace(/[<>:"/\\|?*]/g, '-')
        .replaceAll(/./g, (character) => (character.charCodeAt(0) < 32 ? '-' : character))
        .replace(/\s+/g, '-')
        .replace(/\.+$/g, '')
        .replace(/-+/g, '-'),
    )
    .filter(Boolean)
    .join('-');
  return `${stem || 'collections'}.json`;
}
