import { z } from 'zod';
import type { ViewDefinition } from '../views/contracts';
import { GRAPH_NODE_MIN_HEIGHT, GRAPH_NODE_MIN_WIDTH } from './contracts';
import type {
  GraphAgent,
  GraphEdge,
  GraphFlow,
  GraphNode,
  GraphPreset,
  JsonObject,
  JsonValue,
  ScopeGraph,
} from './contracts';

export const stableIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'must be a stable ID');
export const finiteNumberSchema = z.number().finite();

export const jsonPrimitiveSchema = z.union([z.string(), finiteNumberSchema, z.boolean(), z.null()]);
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);
export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

const strictObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.strictObject(shape);

export const flowPortDeclarationSchema = strictObject({
  id: stableIdSchema,
  label: z.string(),
  required: z.boolean(),
  cardinality: z.literal('ONE'),
  schema: jsonObjectSchema,
});

export const graphNodeSchema: z.ZodType<GraphNode> = strictObject({
  id: stableIdSchema,
  type: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]*$/, 'must be a node type'),
  position: strictObject({ x: finiteNumberSchema, y: finiteNumberSchema }),
  size: strictObject({
    width: finiteNumberSchema.min(GRAPH_NODE_MIN_WIDTH),
    height: finiteNumberSchema.min(GRAPH_NODE_MIN_HEIGHT),
  }).optional(),
  data: jsonObjectSchema,
  inputValues: z.record(z.string().min(1), jsonValueSchema),
});

export const graphEdgeSchema: z.ZodType<GraphEdge> = strictObject({
  id: stableIdSchema,
  kind: z.enum(['CONTROL', 'DATA']),
  source: strictObject({ nodeId: stableIdSchema, portId: z.string().min(1) }),
  target: strictObject({ nodeId: stableIdSchema, portId: z.string().min(1) }),
});

export const scopeGraphSchema: z.ZodType<ScopeGraph> = strictObject({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});

export const graphFlowSchema: z.ZodType<GraphFlow> = strictObject({
  id: stableIdSchema,
  name: z.string(),
  kind: z.enum(['TRIGGER', 'SUBFLOW']),
  inputs: z.array(flowPortDeclarationSchema),
  outputs: z.array(flowPortDeclarationSchema),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
});

export const graphAgentSchema: z.ZodType<GraphAgent> = strictObject({
  id: stableIdSchema,
  name: z.string(),
  enabled: z.boolean(),
  priority: finiteNumberSchema,
  configurationSchema: jsonObjectSchema,
  configurationDefaults: jsonObjectSchema,
  stateSchema: jsonObjectSchema,
  initialState: jsonObjectSchema,
  flows: z.array(graphFlowSchema),
  views: z.array(
    z.custom<ViewDefinition>((value) => value !== null && typeof value === 'object' && !Array.isArray(value)),
  ),
});

export const graphPresetSchema: z.ZodType<GraphPreset> = strictObject({
  format: z.literal('NEOTAVERN_CUSTOM_AGENT_FLOW'),
  agent: graphAgentSchema,
});

export type SchemaParseResult<T> =
  | { success: true; value: T }
  | { success: false; issues: readonly z.core.$ZodIssue[] };

export function parseGraphPresetShape(value: unknown): SchemaParseResult<GraphPreset> {
  const parsed = graphPresetSchema.safeParse(value);
  return parsed.success ? { success: true, value: parsed.data } : { success: false, issues: parsed.error.issues };
}
