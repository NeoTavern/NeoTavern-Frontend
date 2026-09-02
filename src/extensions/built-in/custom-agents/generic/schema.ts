import Ajv, { type ValidateFunction } from 'ajv';
import type { JsonObject, JsonValue } from './json';
import { isSafePath } from './path';
import type { ValidationResult } from './validation';

interface ContiguousRangesConstraint {
  minPath: string;
  maxPath: string;
  minimum: number;
  maximum: number;
}

function ownPathValue(root: unknown, path: string): unknown {
  let selected = root;
  for (const segment of path.split('.')) {
    if (selected === null || typeof selected !== 'object' || !Object.hasOwn(selected, segment)) return undefined;
    selected = (selected as Record<string, unknown>)[segment];
  }
  return selected;
}

function objectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The only JSON Schema compiler used by Custom Agents. Custom keywords are registered exactly once here. */
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
ajv.addKeyword({
  keyword: 'x-own-key-of',
  schemaType: 'string',
  type: 'string',
  metaSchema: { type: 'string', minLength: 1 },
  compile(path: string) {
    if (!isSafePath(path)) throw new Error('x-own-key-of must be a safe path');
    return (value: string, context?: { rootData?: unknown }): boolean => {
      const collection = ownPathValue(context?.rootData, path);
      // Extracted port schemas may retain this root-relative declaration without the containing root object.
      if (collection === undefined) return true;
      return collection !== null && typeof collection === 'object' && Object.hasOwn(collection, value);
    };
  },
});
ajv.addKeyword({
  keyword: 'x-contiguous-ranges',
  schemaType: 'object',
  type: 'array',
  metaSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      minPath: { type: 'string', minLength: 1 },
      maxPath: { type: 'string', minLength: 1 },
      minimum: { type: 'integer' },
      maximum: { type: 'integer' },
    },
    required: ['minPath', 'maxPath', 'minimum', 'maximum'],
  },
  compile(rawConstraint: ContiguousRangesConstraint) {
    const constraint = structuredClone(rawConstraint);
    if (!isSafePath(constraint.minPath) || !isSafePath(constraint.maxPath))
      throw new Error('x-contiguous-ranges paths must be safe');
    if (constraint.minimum > constraint.maximum) throw new Error('x-contiguous-ranges minimum must not exceed maximum');
    return (rows: unknown[]): boolean => {
      let expectedMinimum = constraint.minimum;
      for (const row of rows) {
        const minimum = ownPathValue(row, constraint.minPath);
        const maximum = ownPathValue(row, constraint.maxPath);
        if (
          typeof minimum !== 'number' ||
          !Number.isFinite(minimum) ||
          !Number.isInteger(minimum) ||
          typeof maximum !== 'number' ||
          !Number.isFinite(maximum) ||
          !Number.isInteger(maximum) ||
          minimum !== expectedMinimum ||
          minimum > maximum
        )
          return false;
        expectedMinimum = maximum + 1;
      }
      return expectedMinimum === constraint.maximum + 1;
    };
  },
});

function declarationErrors(schema: JsonObject, label: string): string[] {
  const errors: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!objectValue(value)) return;
    if (Object.hasOwn(value, '$ref')) errors.push(`${path}.$ref is not allowed in authored schemas`);
    if (Object.hasOwn(value, '$defs')) errors.push(`${path}.$defs is not allowed in authored schemas`);
    if (Object.hasOwn(value, 'x-own-key-of')) {
      const declaration = value['x-own-key-of'];
      if (value.type !== 'string') errors.push(`${path}.x-own-key-of requires containing type string`);
      if (typeof declaration !== 'string' || !isSafePath(declaration))
        errors.push(`${path}.x-own-key-of must declare a non-empty safe path`);
    }
    if (Object.hasOwn(value, 'x-contiguous-ranges')) {
      const declaration = value['x-contiguous-ranges'];
      if (value.type !== 'array') errors.push(`${path}.x-contiguous-ranges requires containing type array`);
      if (!objectValue(declaration)) {
        errors.push(`${path}.x-contiguous-ranges must be an object declaration`);
      } else {
        const exactKeys = new Set(['maximum', 'maxPath', 'minimum', 'minPath']);
        const keys = Object.keys(declaration);
        if (keys.length !== exactKeys.size || keys.some((key) => !exactKeys.has(key)))
          errors.push(`${path}.x-contiguous-ranges must contain exactly minPath, maxPath, minimum, and maximum`);
        for (const key of ['minPath', 'maxPath'] as const)
          if (typeof declaration[key] !== 'string' || !isSafePath(declaration[key]))
            errors.push(`${path}.x-contiguous-ranges.${key} must be a non-empty safe path`);
        for (const key of ['minimum', 'maximum'] as const)
          if (!Number.isSafeInteger(declaration[key]))
            errors.push(`${path}.x-contiguous-ranges.${key} must be a safe integer`);
        if (
          Number.isSafeInteger(declaration.minimum) &&
          Number.isSafeInteger(declaration.maximum) &&
          (declaration.minimum as number) > (declaration.maximum as number)
        )
          errors.push(`${path}.x-contiguous-ranges minimum must not exceed maximum`);
      }
    }
    for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`);
  };
  visit(schema, label);
  return errors;
}

/** Strictly validates and compiles a self-contained schema authored by a graph preset. */
export function compileAuthoredSchema(schema: JsonObject, label = 'schema'): ValidateFunction {
  const errors = declarationErrors(schema, label);
  if (errors.length) throw new Error(errors.join('; '));
  if (!ajv.validateSchema(schema)) throw new Error(`${label} is not a valid JSON Schema: ${ajv.errorsText()}`);
  try {
    return ajv.compile(schema);
  } catch (error) {
    throw new Error(
      `${label} is not a self-contained JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function validateAuthoredSchema(schema: JsonObject, label = 'schema'): ValidationResult<JsonObject> {
  try {
    compileAuthoredSchema(schema, label);
    return { valid: true, value: schema, errors: [] };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

/** Validates a JSON value with the same compiler and keyword semantics used for authored schemas. */
export function validateSchemaValue(schema: JsonObject, value: JsonValue, path = 'value'): ValidationResult<JsonValue> {
  try {
    const check = compileAuthoredSchema(schema);
    return check(value)
      ? { valid: true, value, errors: [] }
      : { valid: false, errors: [`${path} does not satisfy its schema: ${ajv.errorsText(check.errors)}`] };
  } catch (error) {
    return {
      valid: false,
      errors: [
        `${path} could not be validated against its schema: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

export function assertSchemaValue(schema: JsonObject, value: JsonValue, path = 'value'): JsonValue {
  const result = validateSchemaValue(schema, value, path);
  if (!result.valid) throw new Error(result.errors.join('; '));
  return structuredClone(result.value);
}
