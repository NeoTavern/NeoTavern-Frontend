import { z } from 'zod';
import type { JsonObject, JsonValue } from '../graph/contracts';
import { projectRequiredProperties } from '../graph/schema-ports';
import type {
  ControlPortDefinition,
  DataPortDefinition,
  InspectorFieldDefinition,
  NodeExecutionResult,
} from '../registry/node-definition';
import { isSafePath } from '../generic/path';
import { assertSchemaValue } from '../generic/schema';

export const emptyDataSchema = z.strictObject({});

export const controlInput = (id = 'in', labelKey = id, literalLabel = false): ControlPortDefinition => ({
  id,
  direction: 'INPUT',
  kind: 'CONTROL',
  cardinality: 'ONE',
  labelKey,
  ...(literalLabel ? { literalLabel: true as const } : {}),
});
export const controlOutput = (id = 'out', labelKey = id, literalLabel = false): ControlPortDefinition => ({
  id,
  direction: 'OUTPUT',
  kind: 'CONTROL',
  cardinality: 'MANY',
  labelKey,
  ...(literalLabel ? { literalLabel: true as const } : {}),
});
export const dataInput = (
  id: string,
  schema: JsonObject,
  required = true,
  inlineEditor?: DataPortDefinition['inlineEditor'],
  labelKey = id,
  schemaPathSource?: DataPortDefinition['schemaPathSource'],
  literalLabel = false,
): DataPortDefinition => ({
  id,
  direction: 'INPUT',
  kind: 'DATA',
  cardinality: 'ONE',
  required,
  schema: structuredClone(schema),
  labelKey,
  ...(literalLabel ? { literalLabel: true as const } : {}),
  ...(inlineEditor ? { inlineEditor } : {}),
  ...(schemaPathSource ? { schemaPathSource } : {}),
});
export const dataOutput = (
  id: string,
  schema: JsonObject,
  required = true,
  labelKey = id,
  literalLabel = false,
): DataPortDefinition => ({
  id,
  direction: 'OUTPUT',
  kind: 'DATA',
  cardinality: 'MANY',
  required,
  schema: structuredClone(schema),
  labelKey,
  ...(literalLabel ? { literalLabel: true as const } : {}),
});

export function projectedOutputs(rootId: string, schema: JsonObject): DataPortDefinition[] {
  return [
    dataOutput(rootId, schema),
    ...projectRequiredProperties(schema).map((property) =>
      dataOutput(property.id, property.schema, true, property.label, true),
    ),
  ];
}

export function projectValue(rootId: string, value: JsonValue, schema: JsonObject): Record<string, JsonValue> {
  const outputs: Record<string, JsonValue> = { [rootId]: structuredClone(value) };
  for (const property of projectRequiredProperties(schema)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, property.label))
      throw new Error(`Required projected property ${property.label} is missing`);
    outputs[property.id] = structuredClone(value[property.label]!);
  }
  return outputs;
}

export function pure(outputs: Record<string, JsonValue>): NodeExecutionResult {
  return { control: [], outputs, effects: [] };
}
export function controlled(
  outputs: Record<string, JsonValue> = {},
  effects: NodeExecutionResult['effects'] = [],
  control: string[] = ['out'],
): NodeExecutionResult {
  return { control, outputs, effects };
}

export const noFields = (): InspectorFieldDefinition[] => [];
export const noInputValues = () => ({});
export const inputField = (id: string, path = id): InspectorFieldDefinition => ({
  id,
  path,
  labelKey: id,
  control: 'INPUT',
});
export const jsonField = (id: string, path = id, optional = false): InspectorFieldDefinition => ({
  id,
  path,
  labelKey: id,
  control: 'JSON',
  ...(optional ? { optional: true } : {}),
});
export const schemaPathField = (
  id: string,
  schemaSource: Extract<InspectorFieldDefinition, { control: 'SCHEMA_PATH' }>['schemaSource'],
  allowRoot: boolean,
  path = id,
): InspectorFieldDefinition => ({
  id,
  path,
  labelKey: id,
  control: 'SCHEMA_PATH',
  schemaSource,
  allowRoot,
});
export const textareaField = (id: string, path = id): InspectorFieldDefinition => ({
  id,
  path,
  labelKey: id,
  control: 'TEXTAREA',
});

export function resolvePath(value: JsonValue, path: string): JsonValue {
  if (!isSafePath(path)) throw new Error(`Unsafe path ${path}`);
  let current = value;
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment) || !Object.hasOwn(current, Number(segment)))
        throw new Error(`Path ${path} does not exist`);
      current = current[Number(segment)]!;
    } else if (current !== null && typeof current === 'object' && Object.hasOwn(current, segment)) {
      current = current[segment]!;
    } else throw new Error(`Path ${path} does not exist`);
  }
  return current;
}

export function pathExists(value: JsonValue, path: string | null): boolean {
  if (path === null) return true;
  try {
    resolvePath(value, path);
    return true;
  } catch {
    return false;
  }
}

export function validateJson(schema: JsonObject, value: JsonValue, label: string): JsonValue {
  return assertSchemaValue(schema, value, label);
}

export { deepEqual } from '../generic/json';

export const safePathSchema = z.string().min(1).refine(isSafePath, 'must be a safe path');
