import { z } from 'zod';
import type { JsonObject, JsonPrimitive, JsonValue } from '../generic/json';
import { isSafePath } from '../generic/path';
import { parseWithSchema, type ValidationResult } from '../generic/validation';
import type { TOOL_IDS } from './tool-contracts';

const finite = z.number().finite();
const integer = finite.int();
const nonnegativeInteger = integer.nonnegative();
const positiveInteger = integer.positive();
const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const JsonPrimitiveSchema: z.ZodType<JsonPrimitive> = z.union([z.string(), finite, z.boolean(), z.null()]);
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);
const JsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), JsonValueSchema);
const SafePathSchema = z.string().refine(isSafePath, 'must be a safe path');
const parse = parseWithSchema;

const MatcherPathSchema = z.union([z.literal(''), SafePathSchema]);
const MatcherSchema = z.discriminatedUnion('operator', [
  strict({ path: MatcherPathSchema, operator: z.enum(['EXISTS', 'MISSING']) }),
  strict({
    path: MatcherPathSchema,
    operator: z.enum(['EQUALS', 'NOT_EQUALS', 'GT', 'GTE', 'LT', 'LTE', 'IN']),
    value: JsonValueSchema,
  }),
]);
const weightedItem = strict({ value: JsonValueSchema, weight: finite.nonnegative() });
const rangeRow = strict({ min: finite, max: finite, value: JsonValueSchema });
const jsonTransformBase = { value: JsonValueSchema, path: SafePathSchema };
const lookupResult = strict({
  found: z.boolean(),
  index: z.union([nonnegativeInteger, z.null()]),
  item: z.union([JsonObjectSchema, z.null()]),
});
export const ToolInputSchemas: Record<(typeof TOOL_IDS)[number], z.ZodTypeAny> = {
  'random.dice': strict({
    expression: z.string().regex(/^(?:[1-9][0-9]*)?d[1-9][0-9]*(?:[+-](?:0|[1-9][0-9]*))?$/),
  }),
  'random.chance': strict({ probability: finite.min(0).max(1) }),
  'random.select': strict({ items: z.array(JsonValueSchema) }),
  'random.selectWeighted': strict({ items: z.array(weightedItem) }),
  'random.sampleWithoutReplacement': strict({ items: z.array(JsonValueSchema), count: nonnegativeInteger }),
  'logic.compare': z.discriminatedUnion('operator', [
    strict({ operator: z.enum(['EQUALS', 'NOT_EQUALS']), left: JsonValueSchema, right: JsonValueSchema }),
    strict({ operator: z.enum(['GT', 'GTE', 'LT', 'LTE']), left: finite, right: finite }),
  ]),
  'number.sum': strict({ values: z.array(finite) }),
  'number.add': strict({ value: finite, amount: finite }),
  'number.clamp': strict({ value: finite, min: finite, max: finite }),
  'string.fromPrimitive': strict({ value: JsonPrimitiveSchema }),
  'string.transform': strict({
    value: z.string(),
    operations: z.array(z.enum(['TRIM', 'LOWERCASE', 'UNDERSCORE_TO_SPACE'])),
  }),
  'string.concat': strict({ values: z.array(z.string()), separator: z.string() }),
  'string.removePrefix': strict({ value: z.string(), prefix: z.string() }),
  'table.lookupKey': strict({ table: z.record(z.string(), JsonValueSchema), key: z.string() }),
  'table.lookupRange': strict({ rows: z.array(rangeRow), number: finite }),
  'json.set': strict({ ...jsonTransformBase, newValue: JsonValueSchema }),
  'json.remove': strict(jsonTransformBase),
  'json.increment': strict({ ...jsonTransformBase, amount: finite }),
  'json.append': strict({ ...jsonTransformBase, item: JsonValueSchema }),
  'json.prepend': strict({ ...jsonTransformBase, item: JsonValueSchema }),
  'json.concat': strict({ ...jsonTransformBase, items: z.array(JsonValueSchema) }),
  'json.removeMatching': strict({ ...jsonTransformBase, match: MatcherSchema }),
  'json.upsertByKey': strict({ ...jsonTransformBase, key: SafePathSchema, item: JsonObjectSchema }),
  'collection.filter': strict({ items: z.array(JsonValueSchema), match: MatcherSchema }),
  'collection.mapFields': strict({
    items: z.array(JsonObjectSchema),
    fields: z.array(strict({ from: SafePathSchema, to: SafePathSchema })),
  }),
  'collection.extract': strict({ items: z.array(JsonObjectSchema), path: SafePathSchema }),
  'collection.lookup': strict({ items: z.array(JsonObjectSchema), key: SafePathSchema, value: JsonPrimitiveSchema }),
  'collection.lookupString': strict({
    items: z.array(JsonObjectSchema),
    key: SafePathSchema,
    value: z.string(),
    caseSensitive: z.boolean(),
  }),
  'collection.filterString': strict({
    items: z.array(JsonObjectSchema),
    path: SafePathSchema,
    operator: z.enum(['EQUALS', 'NOT_EQUALS']),
    value: z.string(),
    caseSensitive: z.boolean(),
  }),
  'collection.flatten': strict({ items: z.array(z.array(JsonValueSchema)) }),
  'id.generate': strict({}),
};
const valueOutput = strict({ value: JsonValueSchema });
const numberOutput = strict({ value: finite });
const itemsAndIndices = strict({ items: z.array(JsonValueSchema), indices: z.array(nonnegativeInteger) });
const objectItemsAndIndices = strict({ items: z.array(JsonObjectSchema), indices: z.array(nonnegativeInteger) });
export const ToolOutputSchemas: Record<(typeof TOOL_IDS)[number], z.ZodTypeAny> = {
  'random.dice': strict({
    count: positiveInteger,
    sides: positiveInteger,
    modifier: integer,
    rolls: z.array(integer),
    total: integer,
  }),
  'random.chance': strict({ roll: finite, result: z.boolean() }),
  'random.select': strict({ index: nonnegativeInteger, value: JsonValueSchema }),
  'random.selectWeighted': strict({ index: nonnegativeInteger, value: JsonValueSchema, weight: finite }),
  'random.sampleWithoutReplacement': strict({ indices: z.array(nonnegativeInteger), items: z.array(JsonValueSchema) }),
  'logic.compare': strict({ result: z.boolean() }),
  'number.sum': numberOutput,
  'number.add': numberOutput,
  'number.clamp': numberOutput,
  'string.fromPrimitive': strict({ value: z.string() }),
  'string.transform': strict({ value: z.string() }),
  'string.concat': strict({ value: z.string() }),
  'string.removePrefix': strict({ matched: z.boolean(), value: z.string() }),
  'table.lookupKey': strict({ key: z.string(), value: JsonValueSchema }),
  'table.lookupRange': strict({ index: nonnegativeInteger, min: finite, max: finite, value: JsonValueSchema }),
  'json.set': valueOutput,
  'json.remove': valueOutput,
  'json.increment': valueOutput,
  'json.append': valueOutput,
  'json.prepend': valueOutput,
  'json.concat': valueOutput,
  'json.removeMatching': valueOutput,
  'json.upsertByKey': strict({ value: JsonValueSchema, index: nonnegativeInteger, replaced: z.boolean() }),
  'collection.filter': itemsAndIndices,
  'collection.mapFields': strict({ items: z.array(JsonObjectSchema) }),
  'collection.extract': strict({ items: z.array(JsonValueSchema) }),
  'collection.lookup': lookupResult,
  'collection.lookupString': lookupResult,
  'collection.filterString': objectItemsAndIndices,
  'collection.flatten': strict({ items: z.array(JsonValueSchema) }),
  'id.generate': strict({ id: z.string() }),
};
export function validateToolInput(
  tool: (typeof TOOL_IDS)[number],
  value: unknown,
  path = 'input',
): ValidationResult<unknown> {
  return parse(ToolInputSchemas[tool], value, path);
}
export function validateToolOutput(
  tool: (typeof TOOL_IDS)[number],
  value: unknown,
  path = 'output',
): ValidationResult<unknown> {
  return parse(ToolOutputSchemas[tool], value, path);
}
