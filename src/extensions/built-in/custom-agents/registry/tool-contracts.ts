import type { JsonObject, JsonPrimitive, JsonValue } from '../generic/json';

export type Matcher =
  | { path: string; operator: 'EXISTS' | 'MISSING' }
  | { path: string; operator: 'EQUALS' | 'NOT_EQUALS' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'IN'; value: JsonValue };
export const TOOL_IDS = [
  'random.dice',
  'random.chance',
  'random.select',
  'random.selectWeighted',
  'random.sampleWithoutReplacement',
  'logic.compare',
  'number.sum',
  'number.add',
  'number.clamp',
  'string.fromPrimitive',
  'string.transform',
  'string.concat',
  'string.removePrefix',
  'table.lookupKey',
  'table.lookupRange',
  'json.set',
  'json.remove',
  'json.increment',
  'json.append',
  'json.prepend',
  'json.concat',
  'json.removeMatching',
  'json.upsertByKey',
  'collection.filter',
  'collection.mapFields',
  'collection.extract',
  'collection.lookup',
  'collection.lookupString',
  'collection.filterString',
  'collection.flatten',
  'id.generate',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];
export interface ToolInputMap {
  'random.dice': { expression: string };
  'random.chance': { probability: number };
  'random.select': { items: JsonValue[] };
  'random.selectWeighted': { items: Array<{ value: JsonValue; weight: number }> };
  'random.sampleWithoutReplacement': { items: JsonValue[]; count: number };
  'logic.compare':
    | { operator: 'EQUALS' | 'NOT_EQUALS'; left: JsonValue; right: JsonValue }
    | { operator: 'GT' | 'GTE' | 'LT' | 'LTE'; left: number; right: number };
  'number.sum': { values: number[] };
  'number.add': { value: number; amount: number };
  'number.clamp': { value: number; min: number; max: number };
  'string.fromPrimitive': { value: JsonPrimitive };
  'string.transform': { value: string; operations: Array<'TRIM' | 'LOWERCASE' | 'UNDERSCORE_TO_SPACE'> };
  'string.concat': { values: string[]; separator: string };
  'string.removePrefix': { value: string; prefix: string };
  'table.lookupKey': { table: Record<string, JsonValue>; key: string };
  'table.lookupRange': { rows: Array<{ min: number; max: number; value: JsonValue }>; number: number };
  'json.set': { value: JsonValue; path: string; newValue: JsonValue };
  'json.remove': { value: JsonValue; path: string };
  'json.increment': { value: JsonValue; path: string; amount: number };
  'json.append': { value: JsonValue; path: string; item: JsonValue };
  'json.prepend': { value: JsonValue; path: string; item: JsonValue };
  'json.concat': { value: JsonValue; path: string; items: JsonValue[] };
  'json.removeMatching': { value: JsonValue; path: string; match: Matcher };
  'json.upsertByKey': { value: JsonValue; path: string; key: string; item: JsonObject };
  'collection.filter': { items: JsonValue[]; match: Matcher };
  'collection.mapFields': { items: JsonObject[]; fields: Array<{ from: string; to: string }> };
  'collection.extract': { items: JsonObject[]; path: string };
  'collection.lookup': { items: JsonObject[]; key: string; value: JsonPrimitive };
  'collection.lookupString': { items: JsonObject[]; key: string; value: string; caseSensitive: boolean };
  'collection.filterString': {
    items: JsonObject[];
    path: string;
    operator: 'EQUALS' | 'NOT_EQUALS';
    value: string;
    caseSensitive: boolean;
  };
  'collection.flatten': { items: JsonValue[][] };
  'id.generate': Record<string, never>;
}
export interface ToolOutputMap {
  'random.dice': { count: number; sides: number; modifier: number; rolls: number[]; total: number };
  'random.chance': { roll: number; result: boolean };
  'random.select': { index: number; value: JsonValue };
  'random.selectWeighted': { index: number; value: JsonValue; weight: number };
  'random.sampleWithoutReplacement': { indices: number[]; items: JsonValue[] };
  'logic.compare': { result: boolean };
  'number.sum': { value: number };
  'number.add': { value: number };
  'number.clamp': { value: number };
  'string.fromPrimitive': { value: string };
  'string.transform': { value: string };
  'string.concat': { value: string };
  'string.removePrefix': { matched: boolean; value: string };
  'table.lookupKey': { key: string; value: JsonValue };
  'table.lookupRange': { index: number; min: number; max: number; value: JsonValue };
  'json.set': { value: JsonValue };
  'json.remove': { value: JsonValue };
  'json.increment': { value: JsonValue };
  'json.append': { value: JsonValue };
  'json.prepend': { value: JsonValue };
  'json.concat': { value: JsonValue };
  'json.removeMatching': { value: JsonValue };
  'json.upsertByKey': { value: JsonValue; index: number; replaced: boolean };
  'collection.filter': { items: JsonValue[]; indices: number[] };
  'collection.mapFields': { items: JsonObject[] };
  'collection.extract': { items: JsonValue[] };
  'collection.lookup': { found: boolean; index: number | null; item: JsonObject | null };
  'collection.lookupString': { found: boolean; index: number | null; item: JsonObject | null };
  'collection.filterString': { items: JsonObject[]; indices: number[] };
  'collection.flatten': { items: JsonValue[] };
  'id.generate': { id: string };
}
