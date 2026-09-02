import { z } from 'zod';
import { schemaAtPath } from '../../graph/schema-ports';
import { defineNode } from '../../registry/node-definition';
import { errorDiagnostic, nodeLocation } from '../../graph/diagnostics';
import { projectedOutputs, projectValue, pure, resolvePath, schemaPathField } from '../shared';
const schema = z.strictObject({ path: z.string().nullable() });
export const configurationNodeDefinition = defineNode({
  type: 'data.configuration',
  labelKey: 'extensionsBuiltin.customAgents.nodes.configuration.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.configuration.description',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: () => ({ path: null }),
  initialInputValues: () => ({}),
  ports: (data, context) => ({
    inputs: [],
    outputs: projectedOutputs('value', schemaAtPath(context.agent.configurationSchema, data.path)),
  }),
  fields: () => [schemaPathField('path', 'CONFIGURATION', true)],
  validate: (context) =>
    context.node.data.path !== null &&
    Object.keys(
      context.ports.outputs.filter((port) => port.kind === 'DATA').find((port) => port.id === 'value')?.schema ?? {},
    ).length === 0
      ? [
          errorDiagnostic(
            'UNKNOWN_SCHEMA_PATH',
            'Configuration path is missing or schema-unknown',
            nodeLocation(context.flow.id, context.node.id, 'data.path'),
          ),
        ]
      : [],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, configuration }) => {
      const value = data.path === null ? configuration : resolvePath(configuration, data.path);
      return pure(projectValue('value', value, {}));
    },
  },
});
