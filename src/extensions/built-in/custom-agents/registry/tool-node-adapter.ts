import { z } from 'zod';
import { compileAuthoredSchema } from '../generic/schema';
import type { JsonObject, JsonValue } from '../graph/contracts';
import { jsonValueSchema } from '../graph/schemas';
import { projectRequiredProperties, schemaAtPath, schemasCanonicallyEqual } from '../graph/schema-ports';
import { TOOL_IDS, type ToolId } from './tool-contracts';
import { ToolInputSchemas, ToolOutputSchemas } from './tool-schemas';
import { defineNode, type NodePortContext, type RegisteredNodeDefinition } from './node-definition';
import { controlInput, controlOutput, dataInput, dataOutput } from '../nodes/shared';

export const VISUAL_TOOL_IDS = TOOL_IDS;
const controlledTools = new Set<ToolId>([
  'random.dice',
  'random.chance',
  'random.select',
  'random.selectWeighted',
  'random.sampleWithoutReplacement',
  'id.generate',
]);
function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function converted(schema: z.ZodTypeAny): JsonObject {
  const value = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' });
  if (!object(value)) throw new Error('Zod schema did not convert to an object');
  delete value.$schema;
  return value;
}
function containsReferences(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(containsReferences);
  if (!object(value)) return false;
  return Object.keys(value).some((key) => key === '$ref' || key === '$defs' || containsReferences(value[key]!));
}
function selfContained(value: unknown): JsonObject {
  return object(value) && !containsReferences(value) ? structuredClone(value) : {};
}
type Shape = { properties: Record<string, JsonObject>; required: Set<string> };
function commonPropertySchema(variants: JsonObject[], memberCount: number): JsonObject {
  if (variants.length !== memberCount || variants.length === 0) return {};
  const first = variants[0];
  if (first && variants.every((item) => schemasCanonicallyEqual(item, first))) return first;
  const commonType = first?.type;
  return typeof commonType === 'string' && variants.every((item) => item.type === commonType)
    ? { type: commonType }
    : {};
}
function objectProperties(value: JsonObject): JsonObject | undefined {
  return object(value.properties) ? value.properties : undefined;
}
function objectMembers(root: JsonObject): Array<{ member: JsonObject; properties: JsonObject }> {
  const composition = Array.isArray(root.oneOf) ? root.oneOf : Array.isArray(root.anyOf) ? root.anyOf : [root];
  return composition.flatMap((candidate) => {
    if (!object(candidate)) return [];
    const properties = objectProperties(candidate);
    return properties ? [{ member: candidate, properties }] : [];
  });
}
function inputShape(tool: ToolId): Shape {
  const members = objectMembers(converted(ToolInputSchemas[tool]));
  const names = [...new Set(members.flatMap(({ properties }) => Object.keys(properties)))];
  const properties: Record<string, JsonObject> = {};
  for (const name of names) {
    const variants = members.flatMap(({ properties: memberProperties }) => {
      const raw = memberProperties[name];
      return object(raw) ? [selfContained(raw)] : [];
    });
    properties[name] = commonPropertySchema(variants, members.length);
  }
  const required = new Set(
    names.filter(
      (name) =>
        members.length > 0 &&
        members.every(({ member }) => Array.isArray(member.required) && member.required.includes(name)),
    ),
  );
  return { properties, required };
}
function outputShape(tool: ToolId): Shape {
  const root = converted(ToolOutputSchemas[tool]);
  if (!object(root.properties)) throw new Error(`Tool ${tool} output must be an object`);
  const properties = Object.fromEntries(
    Object.entries(root.properties).map(([key, value]) => [key, selfContained(value)]),
  );
  return {
    properties,
    required: new Set(
      Array.isArray(root.required) ? root.required.filter((v): v is string => typeof v === 'string') : [],
    ),
  };
}
function bindingSchema(context: NodePortContext, id: string): JsonObject {
  const binding = context.resolveInputBinding(id);
  return binding.kind === 'EDGE' ? binding.source.schema : {};
}
function arrayItems(schema: JsonObject): JsonObject {
  return schema.type === 'array' && object(schema.items) ? schema.items : {};
}
function explicitProperty(schema: JsonObject, key: string): JsonObject | undefined {
  const properties = objectProperties(schema);
  const property = properties?.[key];
  return object(property) ? property : undefined;
}
function dynamicOutput(tool: ToolId, name: string, base: JsonObject, context: NodePortContext): JsonObject {
  const items = bindingSchema(context, 'items');
  if ((tool === 'random.select' || tool === 'random.selectWeighted') && name === 'value') {
    const item = arrayItems(items);
    return tool === 'random.selectWeighted' ? (explicitProperty(item, 'value') ?? {}) : item;
  }
  if (tool === 'random.sampleWithoutReplacement' && name === 'items') return items;
  if ((tool === 'collection.filter' || tool === 'collection.filterString') && name === 'items') return items;
  if (tool === 'table.lookupKey' && name === 'value') {
    const table = bindingSchema(context, 'table');
    const key = context.resolveInputBinding('key');
    if (key.kind === 'INLINE' && typeof key.value === 'string') {
      const found = explicitProperty(table, key.value);
      if (found) return found;
    }
    if (object(table.additionalProperties)) return table.additionalProperties;
    if (object(table.properties)) {
      const values = Object.values(table.properties).filter(object).map(selfContained);
      if (values.length > 0 && values.every((value) => schemasCanonicallyEqual(value, values[0]!))) return values[0]!;
    }
    return {};
  }
  if (tool === 'table.lookupRange' && name === 'value')
    return explicitProperty(arrayItems(bindingSchema(context, 'rows')), 'value') ?? {};
  if (tool === 'collection.extract' && name === 'items') {
    const path = context.resolveInputBinding('path');
    return {
      type: 'array',
      items:
        path.kind === 'INLINE' && typeof path.value === 'string' ? schemaAtPath(arrayItems(items), path.value) : {},
    };
  }
  if (tool === 'collection.flatten' && name === 'items') return { type: 'array', items: arrayItems(arrayItems(items)) };
  return base;
}
function completeSchema(shape: Shape, properties: Record<string, JsonObject>): JsonObject {
  return { type: 'object', properties, required: [...shape.required].sort(), additionalProperties: false };
}
function schemaPathSource(tool: ToolId) {
  if (tool.startsWith('json.')) return { inputPortId: 'value', mode: 'VALUE' as const };
  if (tool === 'collection.extract' || tool === 'collection.filterString')
    return { inputPortId: 'items', mode: 'ARRAY_ITEMS' as const };
  return undefined;
}
export function createToolNodeDefinition(tool: ToolId): RegisteredNodeDefinition {
  const inputs = inputShape(tool),
    outputs = outputShape(tool),
    controlled = controlledTools.has(tool);
  const definition = defineNode({
    type: `tool.${tool}`,
    labelKey: `extensionsBuiltin.customAgents.nodes.tools.${tool}.label`,
    descriptionKey: `extensionsBuiltin.customAgents.nodes.tools.${tool}.description`,
    category: 'TOOL',
    executionClass: controlled ? 'CONTROLLED' : 'PURE_DATA',
    dataSchema: z.strictObject({}),
    initialData: () => ({}),
    initialInputValues: () => ({}),
    ports: (_data, context) => {
      const dynamic = Object.fromEntries(
        Object.entries(outputs.properties).map(([name, schema]) => [name, dynamicOutput(tool, name, schema, context)]),
      );
      const result = completeSchema(outputs, dynamic);
      compileAuthoredSchema(result, `tool.${tool} output schema`);
      return {
        inputs: [
          ...(controlled ? [controlInput()] : []),
          ...Object.entries(inputs.properties).map(([name, schema]) =>
            dataInput(
              name,
              schema,
              inputs.required.has(name),
              name === 'path' ? 'SCHEMA_PATH' : undefined,
              name,
              name === 'path' ? schemaPathSource(tool) : undefined,
            ),
          ),
        ],
        outputs: [
          ...(controlled ? [controlOutput()] : []),
          dataOutput('result', result),
          ...projectRequiredProperties(result).map((property) =>
            dataOutput(property.id, property.schema, true, property.label),
          ),
        ],
      };
    },
    fields: () => [],
    runtime: {
      kind: 'EXECUTOR',
      execute: async (context) => {
        context.signal.throwIfAborted();
        const parsedInput = jsonValueSchema.parse(ToolInputSchemas[tool].parse(structuredClone(context.inputs)));
        const raw = await context.tools.dispatch(tool, parsedInput, {
          signal: context.signal,
          random: context.random,
          ids: context.ids,
        });
        context.signal.throwIfAborted();
        const result = jsonValueSchema.parse(ToolOutputSchemas[tool].parse(raw));
        if (!object(result)) throw new Error(`Tool ${tool} returned a non-object result`);
        return { control: controlled ? ['out'] : [], outputs: { result: structuredClone(result) }, effects: [] };
      },
    },
  });
  return definition;
}
export const toolNodeDefinitions: readonly RegisteredNodeDefinition[] = Object.freeze(
  VISUAL_TOOL_IDS.map(createToolNodeDefinition),
);
