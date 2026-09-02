import { z } from 'zod';
import { schemaAtPath, schemaFromConstant } from '../../graph/schema-ports';
import { defineNode } from '../../registry/node-definition';
import { dataInput, projectedOutputs, pure, resolvePath, schemaPathField } from '../shared';
import { errorDiagnostic, nodeLocation } from '../../graph/diagnostics';
import { isSafePath } from '../../generic/path';
const schema = z.strictObject({ path: z.string() });
export const getNodeDefinition = defineNode({
  type: 'data.get',
  labelKey: 'extensionsBuiltin.customAgents.nodes.get.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.get.description',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: () => ({ path: '' }),
  initialInputValues: () => ({}),
  ports: (data, context) => {
    const binding = context.resolveInputBinding('value');
    const source =
      binding.kind === 'EDGE'
        ? binding.source.schema
        : binding.kind === 'INLINE'
          ? schemaFromConstant(binding.value)
          : {};
    const output = schemaAtPath(source, data.path);
    return { inputs: [dataInput('value', {})], outputs: projectedOutputs('value', output) };
  },
  fields: () => [schemaPathField('path', 'INPUT_VALUE', false)],
  validate: (context) =>
    isSafePath(context.node.data.path)
      ? []
      : [
          errorDiagnostic(
            'UNSAFE_PATH',
            'Path must be a non-empty safe path',
            nodeLocation(context.flow.id, context.node.id, 'data.path'),
          ),
        ],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, inputs }) => pure({ value: structuredClone(resolvePath(inputs.value!, data.path)) }),
  },
});
