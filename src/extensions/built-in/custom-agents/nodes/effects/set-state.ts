import { z } from 'zod';
import { defineNode } from '../../registry/node-definition';
import { controlInput, controlOutput, controlled, dataInput, schemaPathField } from '../shared';
import { isSafePath } from '../../generic/path';
import { errorDiagnostic, nodeLocation } from '../../graph/diagnostics';
const schema = z.strictObject({ path: z.string() });
export const setStateNodeDefinition = defineNode({
  type: 'effect.set-state',
  labelKey: 'extensionsBuiltin.customAgents.nodes.setState.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.setState.description',
  category: 'EFFECT',
  executionClass: 'CONTROLLED',
  dataSchema: schema,
  initialData: () => ({ path: '' }),
  initialInputValues: () => ({}),
  ports: () => ({ inputs: [controlInput(), dataInput('value', {})], outputs: [controlOutput()] }),
  fields: () => [schemaPathField('path', 'STATE', false)],
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
    execute: async ({ data, inputs }) => controlled({}, [{ type: 'STATE_SET', path: data.path, value: inputs.value! }]),
  },
});
