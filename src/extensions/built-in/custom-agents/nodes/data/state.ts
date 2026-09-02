import { z } from 'zod';
import { schemaAtPath } from '../../graph/schema-ports';
import { defineNode } from '../../registry/node-definition';
import { errorDiagnostic, nodeLocation } from '../../graph/diagnostics';
import { projectedOutputs, pure, resolvePath, schemaPathField } from '../shared';
const schema = z.strictObject({ path: z.string().nullable() });
export const stateNodeDefinition = defineNode({
  type: 'data.state',
  labelKey: 'extensionsBuiltin.customAgents.nodes.state.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.state.description',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: () => ({ path: null }),
  initialInputValues: () => ({}),
  ports: (data, context) => ({
    inputs: [],
    outputs: projectedOutputs('value', schemaAtPath(context.agent.stateSchema, data.path)),
  }),
  fields: () => [schemaPathField('path', 'STATE', true)],
  validate: (context) =>
    context.node.data.path !== null &&
    Object.keys(
      context.ports.outputs.filter((port) => port.kind === 'DATA').find((port) => port.id === 'value')?.schema ?? {},
    ).length === 0
      ? [
          errorDiagnostic(
            'UNKNOWN_SCHEMA_PATH',
            'State path is missing or schema-unknown',
            nodeLocation(context.flow.id, context.node.id, 'data.path'),
          ),
        ]
      : [],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, state }) => {
      const value = data.path === null ? state : resolvePath(state, data.path);
      return pure({ value: structuredClone(value) });
    },
  },
});
