import type { JsonObject, JsonPrimitive, JsonValue } from '../generic/json';
import type {
  FormField,
  RowFormField,
  ViewAction,
  ViewBinding,
  ViewCaseValue,
  ViewCondition,
  ViewValue,
} from './contracts';
import { isSafePath } from '../generic/path';

export interface ViewContext {
  state: JsonObject;
  config: JsonObject;
  selectionKey?: string;
}

export function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]!))
    );
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && jsonValuesEqual(left[key]!, right[key]!))
  );
}

export function readPath(root: JsonValue, path: string): JsonValue {
  if (!path || !isSafePath(path)) throw new Error(`Unsafe or empty view path ${path}`);
  let value: JsonValue = root;
  for (const part of path.split('.')) {
    if (Array.isArray(value)) {
      if (!/^\d+$/.test(part) || Number(part) >= value.length) throw new Error(`Unresolved view path ${path}`);
      value = value[Number(part)]!;
    } else if (value !== null && typeof value === 'object' && Object.hasOwn(value, part)) {
      value = value[part]!;
    } else throw new Error(`Unresolved view path ${path}`);
  }
  return structuredClone(value);
}

function tryRead(root: JsonValue, path: string): { found: boolean; value?: JsonValue } {
  try {
    return { found: true, value: readPath(root, path) };
  } catch {
    return { found: false };
  }
}

export function resolveViewBinding(binding: ViewBinding, context: ViewContext): JsonValue {
  const [root, ...segments] = binding.$ref.split('.');
  return readPath(root === 'state' ? context.state : context.config, segments.join('.'));
}

function binding(value: object): value is { $ref: string } {
  return Object.keys(value).length === 1 && typeof (value as { $ref?: unknown }).$ref === 'string';
}

function resolveValue(
  value: ViewValue | ViewCaseValue,
  context: ViewContext,
  scope: { row?: JsonObject; viewValue?: JsonValue },
): JsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (binding(value)) {
    const [root, ...segments] = value.$ref.split('.');
    if (root === 'state' || root === 'config') return readPath(context[root], segments.join('.'));
    if (root === 'row' && scope.row) return readPath(scope.row, segments.join('.'));
    if (value.$ref === 'view.value' && scope.viewValue !== undefined) return structuredClone(scope.viewValue);
    throw new Error(`Binding ${value.$ref} is unavailable in this view scope`);
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, context, scope));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, context, scope)]));
}

export function evaluateViewCondition(condition: ViewCondition, context: ViewContext, viewValue: JsonValue): boolean {
  if ('conditions' in condition)
    return condition.op === 'all'
      ? condition.conditions.every((item) => evaluateViewCondition(item, context, viewValue))
      : condition.conditions.some((item) => evaluateViewCondition(item, context, viewValue));
  if (condition.op === 'not') return !evaluateViewCondition(condition.condition, context, viewValue);
  if ('reference' in condition) {
    let found = false;
    if (condition.reference.$ref === 'view.value') found = true;
    else {
      const [root, ...segments] = condition.reference.$ref.split('.');
      found = tryRead(context[root as 'state' | 'config'], segments.join('.')).found;
    }
    return condition.op === 'exists' ? found : !found;
  }
  if (condition.op === 'in') {
    const value = resolveValue(condition.value, context, { viewValue });
    const collection = resolveValue(condition.collection, context, { viewValue });
    return Array.isArray(collection) && collection.some((item) => jsonValuesEqual(item, value));
  }
  const left = resolveValue(condition.left, context, { viewValue });
  const right = resolveValue(condition.right, context, { viewValue });
  if (condition.op === 'equals') return jsonValuesEqual(left, right);
  if (condition.op === 'notEquals') return !jsonValuesEqual(left, right);
  if (typeof left !== 'number' || typeof right !== 'number') return false;
  if (condition.op === 'gt') return left > right;
  if (condition.op === 'gte') return left >= right;
  if (condition.op === 'lt') return left < right;
  return left <= right;
}

export function normalizeViewRows(value: JsonValue): JsonObject[] {
  if (!Array.isArray(value)) throw new Error('LIST/TABLE binding must resolve to an array');
  return value.map((row) =>
    row !== null && typeof row === 'object' && !Array.isArray(row) ? structuredClone(row) : { value: row },
  );
}

export function projectViewRows(
  value: JsonValue,
  options: { order: 'ASC' | 'DESC'; limit?: number; pageSize?: number; page?: number },
): { rows: JsonObject[]; pageCount: number } {
  let rows = normalizeViewRows(value);
  if (options.order === 'DESC') rows.reverse();
  if (options.limit !== undefined) rows = rows.slice(0, options.limit);
  const pageSize = options.pageSize;
  if (!pageSize) return { rows, pageCount: 1 };
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(options.page ?? 0, 0), pageCount - 1);
  return { rows: rows.slice(page * pageSize, (page + 1) * pageSize), pageCount };
}

export function resolveActionInput(action: ViewAction, context: ViewContext, row?: JsonObject): JsonValue {
  return resolveValue(action.input, context, { ...(row ? { row } : {}) });
}

export function initialFormValues(
  fields: Array<FormField | RowFormField>,
  context: ViewContext,
  row?: JsonObject,
): JsonObject {
  return Object.fromEntries(
    fields.map((field) => {
      if (!field.initial) return [field.name, defaultControlValue(field.control)];
      const value = resolveValue(field.initial, context, { ...(row ? { row } : {}) });
      return [field.name, value];
    }),
  );
}

function defaultControlValue(control: FormField['control']): JsonValue {
  if (control === 'NUMBER') return 0;
  if (control === 'CHECKBOX') return false;
  if (control === 'JSON') return null;
  return '';
}

export function coerceFormInput(fields: Array<FormField | RowFormField>, values: Record<string, unknown>): JsonObject {
  const output: JsonObject = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.control === 'NUMBER') {
      const number = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(number)) throw new Error(`${field.label} must be a number`);
      output[field.name] = number;
    } else if (field.control === 'CHECKBOX') {
      if (typeof value !== 'boolean') throw new Error(`${field.label} must be a boolean`);
      output[field.name] = value;
    } else if (field.control === 'JSON') {
      if (typeof value !== 'string') output[field.name] = value as JsonValue;
      else {
        try {
          output[field.name] = JSON.parse(value) as JsonValue;
        } catch {
          throw new Error(`${field.label} must be valid JSON`);
        }
      }
    } else if (field.control === 'SELECT') {
      output[field.name] = structuredClone(value as JsonValue);
    } else {
      if (typeof value !== 'string') throw new Error(`${field.label} must be text`);
      output[field.name] = value as JsonPrimitive;
    }
  }
  return output;
}
