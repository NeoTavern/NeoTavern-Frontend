import Ajv, { type ErrorObject } from 'ajv';
import { cloneJson } from '../_shared/data-utils';

type JsonObject = Record<string, unknown>;

export type TrackerDeltaMode = 'off' | 'auto' | 'always';

export interface TrackerDeltaAnnotation {
  allow?: boolean;
  delete?: boolean;
  requires?: string[];
  group?: string;
  arrayMerge?: 'replace' | 'byKey';
  key?: string;
  deleteKey?: string;
}

export interface TrackerDeltaBuildResult {
  schema: JsonObject;
  hasDeltaFields: boolean;
}

export interface TrackerDeltaApplyResult {
  full: JsonObject;
  delta: JsonObject;
  usedDelta: boolean;
}

const DELTA_ANNOTATION_KEY = 'x-neotavern-delta';
const NEOTAVERN_PREFIX = 'x-neotavern-';
const UNSET_KEY = '$unset';
const DEFAULT_DELETE_KEY = '$delete';

const ajv = new Ajv({
  coerceTypes: true,
  allErrors: true,
  strict: false,
});

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getSchemaType(schema: JsonObject): string | undefined {
  const type = schema.type;
  if (Array.isArray(type)) return type.find((entry) => entry !== 'null');
  return typeof type === 'string' ? type : undefined;
}

function getAnnotation(schema: JsonObject): TrackerDeltaAnnotation | undefined {
  const raw = schema[DELTA_ANNOTATION_KEY];
  if (raw === true) return { allow: true };
  if (isObject(raw)) return raw as TrackerDeltaAnnotation;
  return undefined;
}

function stripExtensionFields(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripExtensionFields);
  if (!isObject(schema)) return schema;

  const next: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key.startsWith(NEOTAVERN_PREFIX)) continue;
    next[key] = stripExtensionFields(value);
  }
  return next;
}

function relaxSchema(schema: JsonObject): JsonObject {
  const relaxed = stripExtensionFields(cloneJson(schema)) as JsonObject;
  const type = getSchemaType(relaxed);

  if (type === 'object') {
    delete relaxed.required;
    if (isObject(relaxed.properties)) {
      relaxed.properties = Object.fromEntries(
        Object.entries(relaxed.properties).map(([key, value]) => [
          key,
          isObject(value) ? relaxSchema(value) : stripExtensionFields(value),
        ]),
      );
    }
  }

  if (type === 'array' && isObject(relaxed.items)) {
    relaxed.items = relaxSchema(relaxed.items);
  }

  return relaxed;
}

function deriveObjectDeltaSchema(schema: JsonObject, forceAllowChildren: boolean): TrackerDeltaBuildResult | null {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const deltaProperties: JsonObject = {};
  const unsetPaths = collectDeletablePaths(schema);
  let hasDeltaFields = false;

  if (unsetPaths.length > 0) {
    deltaProperties[UNSET_KEY] = {
      type: 'array',
      items: {
        type: 'string',
        enum: unsetPaths,
      },
      uniqueItems: true,
      description: 'Schema-approved tracker paths to remove from the previous full tracker state.',
    };
    hasDeltaFields = true;
  }

  for (const [key, rawPropertySchema] of Object.entries(properties)) {
    if (!isObject(rawPropertySchema)) continue;

    const annotation = getAnnotation(rawPropertySchema);
    const propertyAllowed = forceAllowChildren || annotation?.allow === true;
    const propertyType = getSchemaType(rawPropertySchema);

    let propertyDeltaSchema: JsonObject | null = null;
    if (propertyAllowed) {
      propertyDeltaSchema = relaxSchema(rawPropertySchema);
    } else if (propertyType === 'object') {
      propertyDeltaSchema = deriveObjectDeltaSchema(rawPropertySchema, false)?.schema ?? null;
    } else if (propertyType === 'array' && isObject(rawPropertySchema.items)) {
      const itemDelta = deriveSchema(rawPropertySchema.items, false)?.schema;
      if (itemDelta) {
        const childDeltaSchema: JsonObject = {
          ...(stripExtensionFields(cloneJson(rawPropertySchema)) as JsonObject),
          items: itemDelta,
        };
        delete childDeltaSchema.required;
        propertyDeltaSchema = childDeltaSchema;
      }
    }

    if (!propertyDeltaSchema) continue;

    if (annotation?.arrayMerge === 'byKey' && propertyType === 'array' && isObject(propertyDeltaSchema.items)) {
      const keyName = annotation.key;
      if (keyName) {
        const itemSchema = propertyDeltaSchema.items as JsonObject;
        if (annotation.delete === true) {
          itemSchema.properties = {
            ...(isObject(itemSchema.properties) ? itemSchema.properties : {}),
            [annotation.deleteKey ?? DEFAULT_DELETE_KEY]: {
              type: 'boolean',
              const: true,
              description: 'Delete the keyed item from the previous full tracker state.',
            },
          };
        }
        itemSchema.required = Array.from(
          new Set([...(Array.isArray(itemSchema.required) ? itemSchema.required : []), keyName]),
        );
      }
    }

    deltaProperties[key] = propertyDeltaSchema;
    hasDeltaFields = true;
  }

  if (!hasDeltaFields) return null;

  const deltaSchema = stripExtensionFields(cloneJson(schema)) as JsonObject;
  deltaSchema.properties = deltaProperties;
  delete deltaSchema.required;
  return { schema: deltaSchema, hasDeltaFields };
}

function deriveSchema(schema: unknown, forceAllowChildren: boolean): TrackerDeltaBuildResult | null {
  if (!isObject(schema)) return null;

  const type = getSchemaType(schema);
  if (type === 'object') return deriveObjectDeltaSchema(schema, forceAllowChildren);
  if (forceAllowChildren || getAnnotation(schema)?.allow === true)
    return { schema: relaxSchema(schema), hasDeltaFields: true };
  return null;
}

function collectDeletablePaths(schema: unknown, path: string[] = [], paths: string[] = []): string[] {
  if (!isObject(schema)) return paths;

  const annotation = getAnnotation(schema);
  const type = getSchemaType(schema);
  if (annotation?.delete === true && path.length > 0 && type !== 'array') {
    paths.push(path.join('.'));
  }

  if (type === 'object' && isObject(schema.properties)) {
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      collectDeletablePaths(propertySchema, [...path, key], paths);
    }
  }

  return paths;
}

export function buildTrackerDeltaSchema(schema: unknown): TrackerDeltaBuildResult {
  if (!isObject(schema)) {
    return {
      schema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      hasDeltaFields: false,
    };
  }

  const derived = deriveSchema(schema, false);
  if (derived) return derived;

  return {
    schema: {
      ...(stripExtensionFields(cloneJson(schema)) as JsonObject),
      properties: {},
      required: [],
      additionalProperties: false,
    } as JsonObject,
    hasDeltaFields: false,
  };
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  return errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ') ?? 'Unknown schema error.';
}

export function validateAgainstSchema(value: unknown, schema: unknown, label: string): void {
  if (!isObject(schema)) throw new Error(`${label} schema must be a JSON object.`);
  const cleanSchema = stripExtensionFields(cloneJson(schema));
  const validate = ajv.compile(cleanSchema as object);
  const valid = validate(value);
  if (!valid) {
    throw new Error(`${label} validation failed: ${formatAjvErrors(validate.errors)}`);
  }
}

function pathExists(value: unknown, path: string): boolean {
  const parts = path.split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (!isObject(current) || !(part in current)) return false;
    current = current[part];
  }
  return true;
}

function getPathSchema(schema: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let current = schema;
  for (const part of parts) {
    if (!isObject(current) || !isObject(current.properties)) return undefined;
    current = current.properties[part];
  }
  return current;
}

function collectDependencyRules(
  schema: unknown,
  path: string[] = [],
  rules: Array<{ path: string; requires: string[] }> = [],
) {
  if (!isObject(schema)) return rules;

  const annotation = getAnnotation(schema);
  if (annotation?.allow && annotation.requires?.length) {
    rules.push({
      path: path.join('.'),
      requires: annotation.requires,
    });
  }

  const type = getSchemaType(schema);
  if (type === 'object' && isObject(schema.properties)) {
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      collectDependencyRules(propertySchema, [...path, key], rules);
    }
  }

  if (type === 'array' && isObject(schema.items)) {
    collectDependencyRules(schema.items, path, rules);
  }

  return rules;
}

export function validateTrackerDeltaRules(delta: JsonObject, schema: unknown): void {
  const errors: string[] = [];
  const allowedUnsetPaths = new Set(collectDeletablePaths(schema));
  const unsetPaths = delta[UNSET_KEY];

  if (unsetPaths !== undefined) {
    if (!Array.isArray(unsetPaths)) {
      errors.push(`"${UNSET_KEY}" must be an array of schema-approved paths.`);
    } else {
      for (const path of unsetPaths) {
        if (typeof path !== 'string' || !allowedUnsetPaths.has(path)) {
          errors.push(`"${path}" is not allowed in "${UNSET_KEY}".`);
        }
      }
    }
  }

  for (const rule of collectDependencyRules(schema)) {
    if (!pathExists(delta, rule.path)) continue;
    const parentPath = rule.path.split('.').slice(0, -1).join('.');
    for (const requirement of rule.requires) {
      const requiredPath = requirement.includes('.') || !parentPath ? requirement : `${parentPath}.${requirement}`;
      if (!pathExists(delta, requiredPath)) {
        errors.push(`"${rule.path}" requires "${requiredPath}" in the same delta.`);
      }
    }
  }

  if (errors.length) {
    throw new Error(`Delta rule validation failed: ${errors.join(' ')}`);
  }
}

function getArrayMergeAnnotation(schema: unknown, key: string): TrackerDeltaAnnotation | undefined {
  if (!isObject(schema) || !isObject(schema.properties)) return undefined;
  const propertySchema = schema.properties[key];
  return isObject(propertySchema) ? getAnnotation(propertySchema) : undefined;
}

function isDeleteItem(item: JsonObject, annotation: TrackerDeltaAnnotation): boolean {
  return item[annotation.deleteKey ?? DEFAULT_DELETE_KEY] === true;
}

function stripDeleteKey(item: JsonObject, annotation: TrackerDeltaAnnotation): JsonObject {
  const result = { ...item };
  delete result[annotation.deleteKey ?? DEFAULT_DELETE_KEY];
  return result;
}

function mergeByKey(base: unknown[], delta: unknown[], annotation: TrackerDeltaAnnotation): unknown[] {
  const key = annotation.key;
  if (!key) return cloneJson(delta);

  const result = base.map((item) => cloneJson(item));
  const indexByKey = new Map<unknown, number>();

  result.forEach((item, index) => {
    if (isObject(item) && key in item) indexByKey.set(item[key], index);
  });

  for (const deltaItem of delta) {
    if (!isObject(deltaItem) || !(key in deltaItem)) {
      result.push(cloneJson(deltaItem));
      continue;
    }

    const existingIndex = indexByKey.get(deltaItem[key]);
    if (annotation.delete === true && isDeleteItem(deltaItem, annotation)) {
      if (existingIndex !== undefined) {
        result.splice(existingIndex, 1);
        indexByKey.clear();
        result.forEach((item, index) => {
          if (isObject(item) && key in item) indexByKey.set(item[key], index);
        });
      }
      continue;
    }

    const cleanDeltaItem = stripDeleteKey(deltaItem, annotation);
    if (existingIndex === undefined) {
      indexByKey.set(cleanDeltaItem[key], result.length);
      result.push(cloneJson(cleanDeltaItem));
      continue;
    }

    result[existingIndex] = mergeTrackerDelta(result[existingIndex], cleanDeltaItem);
  }

  return result;
}

function unsetPath(target: JsonObject, path: string): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return;

  let current: unknown = target;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(current)) return;
    current = current[part];
  }

  if (isObject(current)) {
    delete current[parts[parts.length - 1]];
  }
}

function mergeTrackerDelta(base: unknown, delta: unknown, schema?: unknown): unknown {
  if (Array.isArray(delta)) return cloneJson(delta);
  if (!isObject(delta)) return cloneJson(delta);
  if (!isObject(base)) return cloneJson(delta);

  const result = cloneJson(base) as JsonObject;
  for (const [key, value] of Object.entries(delta)) {
    if (key === UNSET_KEY) {
      if (Array.isArray(value)) {
        value.forEach((path) => {
          if (typeof path === 'string') unsetPath(result, path);
        });
      }
      continue;
    }

    const annotation = getArrayMergeAnnotation(schema, key);
    if (Array.isArray(value) && annotation?.arrayMerge === 'byKey' && annotation.key) {
      result[key] = mergeByKey(Array.isArray(result[key]) ? result[key] : [], value, annotation);
      continue;
    }

    const childSchema = isObject(schema) && isObject(schema.properties) ? schema.properties[key] : undefined;
    if (isObject(value) && isObject(result[key])) {
      result[key] = mergeTrackerDelta(result[key], value, childSchema);
    } else {
      result[key] = cloneJson(value);
    }
  }

  return result;
}

export function applyTrackerDelta(previous: JsonObject, delta: JsonObject, fullSchema: unknown): JsonObject {
  return mergeTrackerDelta(previous, delta, fullSchema) as JsonObject;
}

export function validateAndApplyTrackerDelta(
  previous: JsonObject,
  delta: JsonObject,
  fullSchema: unknown,
): TrackerDeltaApplyResult {
  const deltaSchema = buildTrackerDeltaSchema(fullSchema).schema;
  validateAgainstSchema(delta, deltaSchema, 'Tracker delta');
  validateTrackerDeltaRules(delta, fullSchema);
  for (const unsetPath of Array.isArray(delta[UNSET_KEY]) ? delta[UNSET_KEY] : []) {
    const unsetSchema = typeof unsetPath === 'string' ? getPathSchema(fullSchema, unsetPath) : undefined;
    if (!isObject(unsetSchema) || getAnnotation(unsetSchema)?.delete !== true) {
      throw new Error(`Delta rule validation failed: "${String(unsetPath)}" is not deletable.`);
    }
  }
  const full = applyTrackerDelta(previous, delta, fullSchema);
  validateAgainstSchema(full, fullSchema, 'Merged tracker');
  return { full, delta, usedDelta: true };
}
