import { z } from 'zod';
import { jsonValueSchema } from '../../graph/schemas';
import { schemaAtPath } from '../../graph/schema-ports';
import { defineNode } from '../../registry/node-definition';
import { errorDiagnostic, nodeLocation } from '../../graph/diagnostics';
import { projectedOutputs, pure, resolvePath, schemaPathField } from '../shared';
import { triggerEventSchemas } from '../triggers/shared';
const schema = z.strictObject({ path: z.string().nullable() });
export const eventNodeDefinition = defineNode({
  type: 'data.event',
  labelKey: 'extensionsBuiltin.customAgents.nodes.event.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.event.description',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: () => ({ path: null }),
  initialInputValues: () => ({}),
  ports: (data, context) => {
    const trigger = context.flow.nodes.find((node) => node.type.startsWith('trigger.'));
    let eventSchema = trigger ? structuredClone(triggerEventSchemas[trigger.type] ?? {}) : {};
    if (
      trigger?.type === 'trigger.manual' &&
      eventSchema.properties &&
      typeof eventSchema.properties === 'object' &&
      !Array.isArray(eventSchema.properties) &&
      trigger.data.inputSchema &&
      typeof trigger.data.inputSchema === 'object' &&
      !Array.isArray(trigger.data.inputSchema)
    )
      eventSchema.properties.input = structuredClone(trigger.data.inputSchema);
    return { inputs: [], outputs: projectedOutputs('value', schemaAtPath(eventSchema, data.path)) };
  },
  fields: () => [schemaPathField('path', 'EVENT', true)],
  validate: (context) =>
    context.flow.kind !== 'TRIGGER'
      ? [
          errorDiagnostic(
            'EVENT_CONTEXT',
            'Event reads are valid only in trigger flows',
            nodeLocation(context.flow.id, context.node.id),
          ),
        ]
      : context.node.data.path !== null &&
          Object.keys(
            context.ports.outputs.filter((port) => port.kind === 'DATA').find((port) => port.id === 'value')?.schema ??
              {},
          ).length === 0
        ? [
            errorDiagnostic(
              'UNKNOWN_SCHEMA_PATH',
              'Event path is missing or schema-unknown',
              nodeLocation(context.flow.id, context.node.id, 'data.path'),
            ),
          ]
        : [],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, event }) => {
      const value = jsonValueSchema.parse(event);
      return pure({ value: structuredClone(data.path === null ? value : resolvePath(value, data.path)) });
    },
  },
});
