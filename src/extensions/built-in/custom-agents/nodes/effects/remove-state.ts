import { z } from 'zod';
import { defineNode } from '../../registry/node-definition';
import { controlInput, controlOutput, controlled, schemaPathField } from '../shared';
import { isSafePath } from '../../generic/path';
import { errorDiagnostic, nodeLocation } from '../../graph/diagnostics';
const schema = z.strictObject({ path: z.string() });
export const removeStateNodeDefinition = defineNode({
  type: 'effect.remove-state',
  labelKey: 'extensionsBuiltin.customAgents.nodes.removeState.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.removeState.description',
  category: 'EFFECT',
  executionClass: 'CONTROLLED',
  dataSchema: schema,
  initialData: () => ({ path: '' }),
  initialInputValues: () => ({}),
  ports: () => ({ inputs: [controlInput()], outputs: [controlOutput()] }),
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
    execute: async ({ data }) => controlled({}, [{ type: 'STATE_REMOVE', path: data.path }]),
  },
});
