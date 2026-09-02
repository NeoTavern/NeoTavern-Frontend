import type { JsonObject, JsonValue } from './contracts';

export type SchemaValueType = 'JSON' | 'STRING' | 'NUMBER' | 'BOOLEAN' | 'OBJECT' | 'ARRAY';

export type RequiredPropertyProjection = {
  id: string;
  label: string;
  schema: JsonObject;
};

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function primitiveType(value: JsonValue): SchemaValueType {
  if (typeof value === 'string') return 'STRING';
  if (typeof value === 'number') return 'NUMBER';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (Array.isArray(value)) return 'ARRAY';
  if (value !== null && typeof value === 'object') return 'OBJECT';
  return 'JSON';
}

export function schemaValueType(schema: Readonly<JsonObject>): SchemaValueType {
  if (Object.hasOwn(schema, 'anyOf') || Object.hasOwn(schema, 'oneOf')) return 'JSON';
  const type = schema.type;
  if (type === 'string') return 'STRING';
  if (type === 'number' || type === 'integer') return 'NUMBER';
  if (type === 'boolean') return 'BOOLEAN';
  if (type === 'object') return 'OBJECT';
  if (type === 'array') return 'ARRAY';
  if (Object.hasOwn(schema, 'type')) return 'JSON';
  const values = Array.isArray(schema.enum) ? schema.enum : Object.hasOwn(schema, 'const') ? [schema.const] : [];
  if (values.length === 0) return 'JSON';
  const first = primitiveType(values[0]!);
  const primitive = first === 'STRING' || first === 'NUMBER' || first === 'BOOLEAN';
  return primitive && values.every((value) => primitiveType(value) === first) ? first : 'JSON';
}

export function schemaFromConstant(value: JsonValue): JsonObject {
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (Array.isArray(value)) return { type: 'array' };
  if (value !== null && typeof value === 'object') return { type: 'object' };
  return {};
}

export function escapeSchemaPropertySegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

export function propertyPortId(property: string): string {
  return `property/${escapeSchemaPropertySegment(property)}`;
}

export function schemaAtPath(schema: Readonly<JsonObject>, path: string | null): JsonObject {
  if (path === null || path === '') return structuredClone(schema);
  let current: Readonly<JsonObject> = schema;
  for (const segment of path.split('.')) {
    if (schemaValueType(current) === 'OBJECT') {
      const properties = current.properties;
      if (!isJsonObject(properties) || !Object.hasOwn(properties, segment)) return {};
      const selected = properties[segment];
      if (!isJsonObject(selected)) return {};
      current = selected;
      continue;
    }
    if (schemaValueType(current) === 'ARRAY') {
      if (!/^(0|[1-9][0-9]*)$/.test(segment) || !isJsonObject(current.items)) return {};
      current = current.items;
      continue;
    }
    return {};
  }
  return structuredClone(current);
}

export function projectRequiredProperties(schema: Readonly<JsonObject>): RequiredPropertyProjection[] {
  if (schemaValueType(schema) !== 'OBJECT' || !isJsonObject(schema.properties) || !Array.isArray(schema.required))
    return [];
  const properties = schema.properties;
  const required = new Set(schema.required.filter((value): value is string => typeof value === 'string'));
  return Object.keys(properties)
    .filter((property) => required.has(property) && isJsonObject(properties[property]))
    .sort(compareText)
    .flatMap((property) => {
      const propertySchema = properties[property];
      return isJsonObject(propertySchema)
        ? [{ id: propertyPortId(property), label: property, schema: structuredClone(propertySchema) }]
        : [];
    });
}

export function schemasCanonicallyEqual(left: Readonly<JsonObject>, right: Readonly<JsonObject>): boolean {
  const canonical = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map((key) => [key, canonical(value[key]!)]),
    );
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function arePortSchemasAssignable(source: Readonly<JsonObject>, target: Readonly<JsonObject>): boolean {
  const sourceType = schemaValueType(source);
  const targetType = schemaValueType(target);
  return sourceType === targetType || (targetType === 'JSON' && sourceType !== 'JSON');
}
