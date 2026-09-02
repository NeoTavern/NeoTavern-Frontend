import type { JsonObject, JsonValue } from '../generic/json';
import { isSafePath } from '../generic/path';
import { assertValid } from '../generic/validation';
import type { IdSource, RandomSource, ToolDispatcher } from './node-definition';
import { TOOL_IDS, type Matcher, type ToolId, type ToolInputMap, type ToolOutputMap } from './tool-contracts';
import { validateToolInput, validateToolOutput } from './tool-schemas';

export interface DispatchServices {
  signal: AbortSignal;
  random: RandomSource;
  ids: IdSource;
}

type PathContainer = JsonValue[] | JsonObject;
type ResolvedPath = { parent: PathContainer; key: string | number; value: JsonValue };

function clone<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) fail('Tool invocation was cancelled');
}

function own(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function pathParts(path: string): string[] {
  if (!isSafePath(path)) fail(`Malformed path: ${path}`);
  return path.split('.');
}

function childAt(value: JsonValue, segment: string, path: string): JsonValue {
  if (Array.isArray(value)) {
    if (!/^(0|[1-9][0-9]*)$/.test(segment)) fail(`Path ${path} requires an array index`);
    const index = Number(segment);
    if (!own(value, index)) fail(`Path ${path} does not exist`);
    return value[index]!;
  }
  if (value === null || typeof value !== 'object') fail(`Path ${path} cannot traverse a primitive`);
  if (!own(value, segment)) fail(`Path ${path} does not exist`);
  return value[segment]!;
}

function resolve(value: JsonValue, path: string): JsonValue {
  let current = value;
  const parts = pathParts(path);
  for (let index = 0; index < parts.length; index += 1) {
    current = childAt(current, parts[index]!, parts.slice(0, index + 1).join('.'));
  }
  return current;
}

function resolveParent(value: JsonValue, path: string, allowMissingFinal = false): ResolvedPath {
  const parts = pathParts(path);
  let parent: JsonValue = value;
  for (let index = 0; index < parts.length - 1; index += 1) {
    parent = childAt(parent, parts[index]!, parts.slice(0, index + 1).join('.'));
  }
  if (parent === null || typeof parent !== 'object') fail(`Path ${path} cannot traverse a primitive`);
  const segment = parts.at(-1)!;
  if (Array.isArray(parent)) {
    if (!/^(0|[1-9][0-9]*)$/.test(segment)) fail(`Path ${path} requires an array index`);
    const index = Number(segment);
    if (!own(parent, index)) fail(`Path ${path} does not exist`);
    return { parent, key: index, value: parent[index]! };
  }
  if (!allowMissingFinal && !own(parent, segment)) fail(`Path ${path} does not exist`);
  return { parent, key: segment, value: parent[segment] as JsonValue };
}

function deepEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]!));
  }
  const leftObject = left as JsonObject;
  const rightObject = right as JsonObject;
  const keys = Object.keys(leftObject);
  return (
    keys.length === Object.keys(rightObject).length &&
    keys.every((key) => own(rightObject, key) && deepEqual(leftObject[key]!, rightObject[key]!))
  );
}

function compare(operator: 'GT' | 'GTE' | 'LT' | 'LTE', left: JsonValue, right: JsonValue): boolean {
  if (typeof left !== 'number' || typeof right !== 'number') fail(`${operator} requires numeric values`);
  if (operator === 'GT') return left > right;
  if (operator === 'GTE') return left >= right;
  if (operator === 'LT') return left < right;
  return left <= right;
}

function matches(item: JsonValue, matcher: Matcher): boolean {
  let value: JsonValue;
  try {
    value = matcher.path === '' ? item : resolve(item, matcher.path);
  } catch (error) {
    if (matcher.operator === 'MISSING') return true;
    if (matcher.operator === 'EXISTS') return false;
    throw error;
  }
  if (matcher.operator === 'EXISTS') return true;
  if (matcher.operator === 'MISSING') return false;
  const comparison = matcher as Extract<Matcher, { value: JsonValue }>;
  if (comparison.operator === 'EQUALS') return deepEqual(value, comparison.value);
  if (comparison.operator === 'NOT_EQUALS') return !deepEqual(value, comparison.value);
  if (comparison.operator === 'IN') {
    if (!Array.isArray(comparison.value)) fail('IN matcher value must be an array');
    return comparison.value.some((candidate) => deepEqual(value, candidate));
  }
  return compare(comparison.operator, value, comparison.value);
}

function finite(value: number, operation: string): number {
  if (!Number.isFinite(value)) fail(`${operation} produced a non-finite number`);
  return value;
}

function randomRoll(services: DispatchServices): number {
  checkCancellation(services.signal);
  const roll = services.random.next();
  checkCancellation(services.signal);
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) fail('Random source must return a finite number in [0, 1)');
  return roll;
}

function randomIndex(length: number, services: DispatchServices): number {
  return Math.floor(randomRoll(services) * length);
}

function createDestinationParent(root: JsonObject, path: string): { parent: JsonObject; key: string } {
  const parts = pathParts(path);
  let parent = root;
  for (const segment of parts.slice(0, -1)) {
    if (!own(parent, segment)) parent[segment] = {};
    const child = parent[segment];
    if (child === null || typeof child !== 'object' || Array.isArray(child))
      fail(`Destination path ${path} has incompatible fields`);
    parent = child;
  }
  return { parent, key: parts.at(-1)! };
}

function keyedValues(items: JsonObject[], key: string): JsonValue[] {
  const values = items.map((item) => resolve(item, key));
  for (let index = 0; index < values.length; index += 1) {
    if (values.slice(0, index).some((value) => deepEqual(value, values[index]!)))
      fail('Duplicate keyed values are not allowed');
  }
  return values;
}

function keyedMatches(items: JsonObject[], key: string, wanted: JsonValue): number[] {
  return keyedValues(items, key).flatMap((value, index) => (deepEqual(value, wanted) ? [index] : []));
}

function lookupResult(items: JsonObject[], indices: number[]): ToolOutputMap['collection.lookup'] {
  if (indices.length > 1) fail('Duplicate keyed values are not allowed');
  if (indices.length === 0) return { found: false, index: null, item: null };
  const index = indices[0]!;
  return { found: true, index, item: clone(items[index]!) };
}

function execute(tool: ToolId, rawInput: JsonValue, services: DispatchServices): JsonValue {
  const input = assertValid(validateToolInput(tool, rawInput, `${tool} input`)) as ToolInputMap[ToolId];
  checkCancellation(services.signal);
  switch (tool) {
    case 'random.dice': {
      const { expression } = input as ToolInputMap['random.dice'];
      const match = /^(?:(\d+))?d(\d+)(?:([+-])(\d+))?$/.exec(expression);
      if (!match) fail('Malformed dice expression');
      const count = match[1] === undefined ? 1 : Number(match[1]);
      const sides = Number(match[2]);
      const magnitude = match[4] === undefined ? 0 : Number(match[4]);
      const modifier = match[3] === '-' ? -magnitude : magnitude;
      if (
        !Number.isSafeInteger(count) ||
        count <= 0 ||
        !Number.isSafeInteger(sides) ||
        sides <= 0 ||
        !Number.isSafeInteger(modifier)
      )
        fail('Dice terms must be safe integers');
      const rolls = Array.from({ length: count }, () => randomIndex(sides, services) + 1);
      const total = rolls.reduce((sum, roll) => sum + roll, modifier);
      if (!Number.isSafeInteger(total)) fail('Dice total is not a safe integer');
      return { count, sides, modifier, rolls, total };
    }
    case 'random.chance': {
      const { probability } = input as ToolInputMap['random.chance'];
      const roll = randomRoll(services);
      return { roll, result: roll < probability };
    }
    case 'random.select': {
      const { items } = input as ToolInputMap['random.select'];
      if (items.length === 0) fail('Cannot select from an empty array');
      const index = randomIndex(items.length, services);
      return { index, value: clone(items[index]!) };
    }
    case 'random.selectWeighted': {
      const { items } = input as ToolInputMap['random.selectWeighted'];
      if (items.length === 0) fail('Cannot select from an empty array');
      const total = items.reduce((sum, item) => finite(sum + item.weight, 'Weight total'), 0);
      if (total <= 0) fail('Weight total must be positive');
      const target = randomRoll(services) * total;
      let cumulative = 0;
      let index = items.length - 1;
      for (let current = 0; current < items.length; current += 1) {
        cumulative += items[current]!.weight;
        if (target < cumulative) {
          index = current;
          break;
        }
      }
      const selected = items[index]!;
      return { index, value: clone(selected.value), weight: selected.weight };
    }
    case 'random.sampleWithoutReplacement': {
      const { items, count } = input as ToolInputMap['random.sampleWithoutReplacement'];
      if (items.length === 0) fail('Cannot sample from an empty array');
      if (count > items.length) fail('Sample count exceeds item count');
      const remaining = items.map((_, index) => index);
      const indices: number[] = [];
      while (indices.length < count) indices.push(remaining.splice(randomIndex(remaining.length, services), 1)[0]!);
      return { indices, items: indices.map((index) => clone(items[index]!)) };
    }
    case 'logic.compare': {
      const value = input as ToolInputMap['logic.compare'];
      if (value.operator === 'EQUALS') return { result: deepEqual(value.left, value.right) };
      if (value.operator === 'NOT_EQUALS') return { result: !deepEqual(value.left, value.right) };
      return { result: compare(value.operator, value.left, value.right) };
    }
    case 'number.sum':
      return {
        value: finite(
          (input as ToolInputMap['number.sum']).values.reduce((sum, value) => sum + value, 0),
          'Sum',
        ),
      };
    case 'number.add': {
      const value = input as ToolInputMap['number.add'];
      return { value: finite(value.value + value.amount, 'Addition') };
    }
    case 'number.clamp': {
      const value = input as ToolInputMap['number.clamp'];
      if (value.min > value.max) fail('Clamp minimum exceeds maximum');
      return { value: Math.min(value.max, Math.max(value.min, value.value)) };
    }
    case 'string.fromPrimitive': {
      const value = (input as ToolInputMap['string.fromPrimitive']).value;
      return { value: typeof value === 'string' ? value : JSON.stringify(value) };
    }
    case 'string.transform': {
      const value = input as ToolInputMap['string.transform'];
      return {
        value: value.operations.reduce(
          (result, operation) =>
            operation === 'TRIM'
              ? result.trim()
              : operation === 'LOWERCASE'
                ? result.toLowerCase()
                : result.replaceAll('_', ' '),
          value.value,
        ),
      };
    }
    case 'string.concat': {
      const value = input as ToolInputMap['string.concat'];
      return { value: value.values.join(value.separator) };
    }
    case 'string.removePrefix': {
      const value = input as ToolInputMap['string.removePrefix'];
      const matched = value.value.startsWith(value.prefix);
      return { matched, value: matched ? value.value.slice(value.prefix.length) : value.value };
    }
    case 'table.lookupKey': {
      const value = input as ToolInputMap['table.lookupKey'];
      if (!own(value.table, value.key)) fail(`Table key ${value.key} was not found`);
      return { key: value.key, value: clone(value.table[value.key]!) };
    }
    case 'table.lookupRange': {
      const value = input as ToolInputMap['table.lookupRange'];
      value.rows.forEach((row) => {
        if (row.min > row.max) fail('Range minimum exceeds maximum');
      });
      for (let left = 0; left < value.rows.length; left += 1)
        for (let right = left + 1; right < value.rows.length; right += 1)
          if (value.rows[left]!.min <= value.rows[right]!.max && value.rows[right]!.min <= value.rows[left]!.max)
            fail('Table ranges overlap');
      const indices = value.rows.flatMap((row, index) =>
        value.number >= row.min && value.number <= row.max ? [index] : [],
      );
      if (indices.length !== 1) fail('Range lookup must yield exactly one match');
      const index = indices[0]!;
      const row = value.rows[index]!;
      return { index, min: row.min, max: row.max, value: clone(row.value) };
    }
    case 'json.set': {
      const value = input as ToolInputMap['json.set'];
      const result = clone(value.value);
      const target = resolveParent(result, value.path, true);
      target.parent[target.key as never] = clone(value.newValue) as never;
      return { value: result };
    }
    case 'json.remove': {
      const value = input as ToolInputMap['json.remove'];
      const result = clone(value.value);
      const target = resolveParent(result, value.path);
      if (Array.isArray(target.parent)) target.parent.splice(target.key as number, 1);
      else delete target.parent[target.key as string];
      return { value: result };
    }
    case 'json.increment': {
      const value = input as ToolInputMap['json.increment'];
      const result = clone(value.value);
      const target = resolveParent(result, value.path);
      if (typeof target.value !== 'number') fail('Increment target must be a number');
      target.parent[target.key as never] = finite(target.value + value.amount, 'Increment') as never;
      return { value: result };
    }
    case 'json.append':
    case 'json.prepend':
    case 'json.concat': {
      const value = input as ToolInputMap['json.append'] | ToolInputMap['json.prepend'] | ToolInputMap['json.concat'];
      const result = clone(value.value);
      const target = resolve(result, value.path);
      if (!Array.isArray(target)) fail(`${tool} target must be an array`);
      if (tool === 'json.append') target.push(clone((value as ToolInputMap['json.append']).item));
      else if (tool === 'json.prepend') target.unshift(clone((value as ToolInputMap['json.prepend']).item));
      else target.push(...clone((value as ToolInputMap['json.concat']).items));
      return { value: result };
    }
    case 'json.removeMatching': {
      const value = input as ToolInputMap['json.removeMatching'];
      const result = clone(value.value);
      const target = resolve(result, value.path);
      if (!Array.isArray(target)) fail('removeMatching target must be an array');
      const kept = target.filter((item) => !matches(item, value.match));
      target.splice(0, target.length, ...kept);
      return { value: result };
    }
    case 'json.upsertByKey': {
      const value = input as ToolInputMap['json.upsertByKey'];
      const result = clone(value.value);
      const target = resolve(result, value.path);
      if (
        !Array.isArray(target) ||
        target.some((item) => item === null || typeof item !== 'object' || Array.isArray(item))
      )
        fail('upsertByKey target must be an object array');
      const wanted = resolve(value.item, value.key);
      const indices = keyedMatches(target as JsonObject[], value.key, wanted);
      if (indices.length > 1) fail('Duplicate keyed values are not allowed');
      const replaced = indices.length === 1;
      const index = replaced ? indices[0]! : target.length;
      if (replaced) target[index] = clone(value.item);
      else target.push(clone(value.item));
      return { value: result, index, replaced };
    }
    case 'collection.filter': {
      const value = input as ToolInputMap['collection.filter'];
      const indices = value.items.flatMap((item, index) => (matches(item, value.match) ? [index] : []));
      return { items: indices.map((index) => clone(value.items[index]!)), indices };
    }
    case 'collection.mapFields': {
      const value = input as ToolInputMap['collection.mapFields'];
      return {
        items: value.items.map((item) => {
          const output: JsonObject = {};
          for (const field of value.fields) {
            const target = createDestinationParent(output, field.to);
            target.parent[target.key] = clone(resolve(item, field.from));
          }
          return output;
        }),
      };
    }
    case 'collection.extract': {
      const value = input as ToolInputMap['collection.extract'];
      return { items: value.items.map((item) => clone(resolve(item, value.path))) };
    }
    case 'collection.lookup': {
      const value = input as ToolInputMap['collection.lookup'];
      return lookupResult(value.items, keyedMatches(value.items, value.key, value.value));
    }
    case 'collection.lookupString': {
      const value = input as ToolInputMap['collection.lookupString'];
      const wanted = value.caseSensitive ? value.value : value.value.toLowerCase();
      const values = keyedValues(value.items, value.key);
      const indices = values.flatMap((candidate, index) => {
        if (typeof candidate !== 'string') fail('lookupString key must resolve to a string');
        return (value.caseSensitive ? candidate : candidate.toLowerCase()) === wanted ? [index] : [];
      });
      return lookupResult(value.items, indices);
    }
    case 'collection.filterString': {
      const value = input as ToolInputMap['collection.filterString'];
      const wanted = value.caseSensitive ? value.value : value.value.toLowerCase();
      const indices = value.items.flatMap((item, index) => {
        const candidate = resolve(item, value.path);
        if (typeof candidate !== 'string') fail('filterString path must resolve to a string');
        const equal = (value.caseSensitive ? candidate : candidate.toLowerCase()) === wanted;
        return (value.operator === 'EQUALS' ? equal : !equal) ? [index] : [];
      });
      return { items: indices.map((index) => clone(value.items[index]!)), indices };
    }
    case 'collection.flatten':
      return { items: clone((input as ToolInputMap['collection.flatten']).items.flat()) };
    case 'id.generate': {
      checkCancellation(services.signal);
      const id = services.ids.generate();
      checkCancellation(services.signal);
      if (typeof id !== 'string') fail('ID source must return a string');
      return { id };
    }
  }
}

export class GenericToolCatalog implements ToolDispatcher {
  async dispatch(tool: ToolId, input: JsonValue, services: DispatchServices): Promise<JsonValue> {
    if (!(TOOL_IDS as readonly string[]).includes(tool)) fail(`Unknown tool ${tool}`);
    const output = execute(tool, input, services);
    checkCancellation(services.signal);
    return clone(assertValid(validateToolOutput(tool, output, `${tool} output`)) as JsonValue);
  }
}

export const genericToolCatalog: ToolDispatcher = new GenericToolCatalog();
