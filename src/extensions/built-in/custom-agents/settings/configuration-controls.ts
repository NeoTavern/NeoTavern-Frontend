import { isJsonValue, type JsonObject, type JsonPrimitive, type JsonValue } from '../generic/json';

export interface ConfigurationProperty {
  type?: string;
  title?: string;
  enum?: unknown;
  properties?: Record<string, ConfigurationProperty>;
  additionalProperties?: boolean | ConfigurationProperty;
  minProperties?: number;
  'x-own-key-of'?: unknown;
}

export interface NamedMapSchema {
  property: ConfigurationProperty;
  entry: ConfigurationProperty & { properties: Record<string, ConfigurationProperty> };
}

export function namedMapSchema(property: ConfigurationProperty): NamedMapSchema | undefined {
  const entry = property.additionalProperties;
  if (
    property.type !== 'object' ||
    entry === null ||
    typeof entry !== 'object' ||
    entry.type !== 'object' ||
    !entry.properties ||
    Object.keys(entry.properties).length === 0
  )
    return undefined;
  return { property, entry: entry as NamedMapSchema['entry'] };
}

export function namedMapActiveProperty(
  properties: Record<string, ConfigurationProperty>,
  mapKey: string,
): string | undefined {
  const matches = Object.entries(properties)
    .filter(([, property]) => property['x-own-key-of'] === mapKey)
    .map(([key]) => key);
  return matches.length === 1 ? matches[0] : undefined;
}

export function normalizedNamedMapName(value: string): string | undefined {
  const name = value.trim();
  return name && !['__proto__', 'prototype', 'constructor'].includes(name) ? name : undefined;
}

export interface ConfigurationSelectOption {
  label: string;
  value: string;
  jsonValue: JsonValue;
}

export function primitiveAdapterKey(value: JsonPrimitive): string {
  if (value === null) return 'null:null';
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return `boolean:${value}`;
  return `number:${Object.is(value, -0) ? '-0' : String(value)}`;
}

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function adapterKey(value: JsonValue): string {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
    return primitiveAdapterKey(value as JsonPrimitive);
  return `${Array.isArray(value) ? 'array' : 'object'}:${stableJson(value)}`;
}

function ownPathValue(root: JsonObject, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, part))
      return undefined;
    current = (current as JsonObject)[part];
  }
  return current;
}

export function configurationSelectOptions(
  property: ConfigurationProperty,
  configuration: JsonObject,
): ConfigurationSelectOption[] | undefined {
  if (Array.isArray(property.enum) && property.enum.every(isJsonValue)) {
    return property.enum.map((value) => ({
      label:
        value !== null && typeof value === 'object' ? JSON.stringify(value) : value === null ? 'null' : String(value),
      value: adapterKey(value),
      jsonValue: value,
    }));
  }

  if (typeof property['x-own-key-of'] === 'string') {
    const collection = ownPathValue(configuration, property['x-own-key-of']);
    if (collection !== null && typeof collection === 'object' && !Array.isArray(collection)) {
      return Object.keys(collection).map((jsonValue) => ({
        label: jsonValue,
        value: primitiveAdapterKey(jsonValue),
        jsonValue,
      }));
    }
  }

  return undefined;
}

export function selectedPrimitiveKey(options: ConfigurationSelectOption[], value: unknown): string {
  if (!isJsonValue(value)) return '';
  const key = adapterKey(value);
  return options.some((option) => option.value === key) ? key : '';
}

export function selectedPrimitiveValue(options: ConfigurationSelectOption[], key: string): JsonValue {
  const option = options.find((candidate) => candidate.value === key);
  if (!option) throw new Error(`Unknown configuration selection ${key}`);
  return structuredClone(option.jsonValue);
}
