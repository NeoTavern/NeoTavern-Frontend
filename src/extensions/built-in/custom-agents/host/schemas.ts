import { z } from 'zod';
import type { JsonObject, JsonValue } from '../generic/json';
import { parseWithSchema, type ValidationResult } from '../generic/validation';
import type { ActiveInjection, AgentCheckpoint, CustomAgentsCheckpoint } from './contracts';

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be an ID');
const finite = z.number().finite();
const nonnegativeInteger = finite.int().nonnegative();
const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);
const jsonPrimitiveSchema = z.union([z.string(), finite, z.boolean(), z.null()]);
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);
const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);
const activeInjectionSchema: z.ZodType<ActiveInjection> = strict({
  id,
  flowId: id,
  content: z.string(),
  placement: z.enum(['relative', 'in-chat']),
  depth: nonnegativeInteger,
  lifetime: z.discriminatedUnion('type', [
    strict({ type: z.literal('ONCE') }),
    strict({ type: z.literal('UNTIL_REMOVED') }),
    strict({ type: z.literal('FOR_N_GENERATIONS'), remaining: nonnegativeInteger }),
  ]),
  activation: z.discriminatedUnion('type', [
    strict({ type: z.literal('ALWAYS') }),
    strict({ type: z.literal('PROBABILITY'), probability: finite.min(0).max(1) }),
  ]),
});
const agentCheckpointSchema: z.ZodType<AgentCheckpoint> = strict({
  state: jsonObjectSchema,
  injections: z.array(activeInjectionSchema),
  flowEventCounts: z.record(id, nonnegativeInteger),
});
const checkpointSchema: z.ZodType<CustomAgentsCheckpoint> = strict({
  agents: z.record(id, agentCheckpointSchema),
});

export function validateCheckpoint(value: unknown, path = 'checkpoint'): ValidationResult<CustomAgentsCheckpoint> {
  return parseWithSchema(checkpointSchema, value, path);
}
