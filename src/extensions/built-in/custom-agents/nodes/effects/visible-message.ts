import { z } from 'zod';
import { defineNode } from '../../registry/node-definition';
import { controlInput, controlOutput, controlled, dataInput } from '../shared';
import { triggerDeclaration, nodeError } from './shared';
const schema = z.strictObject({ operation: z.enum(['REPLACE_TARGET', 'APPEND_TARGET', 'CREATE']) });
export const visibleMessageNodeDefinition = defineNode<z.infer<typeof schema>>({
  type: 'effect.visible-message',
  labelKey: 'extensionsBuiltin.customAgents.nodes.visibleMessage.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.visibleMessage.description',
  category: 'EFFECT',
  executionClass: 'CONTROLLED',
  dataSchema: schema,
  initialData: () => ({ operation: 'CREATE' }),
  initialInputValues: () => ({}),
  ports: () => ({
    inputs: [controlInput(), dataInput('content', { type: 'string' }, true, 'TEXTAREA')],
    outputs: [controlOutput()],
  }),
  fields: () => [
    {
      id: 'operation',
      path: 'operation',
      labelKey: 'operation',
      control: 'SELECT',
      options: ['REPLACE_TARGET', 'APPEND_TARGET', 'CREATE'].map((value) => ({ labelKey: value, value })),
    },
  ],
  validate: (context) => {
    const declaration = triggerDeclaration(context);
    return declaration && ['AFTER_USER', 'AFTER_GENERATION', 'MANUAL'].includes(declaration.event)
      ? []
      : nodeError(
          context,
          'VISIBLE_MESSAGE_CONTEXT',
          'Visible messages require an AFTER_USER, AFTER_GENERATION, or MANUAL flow',
        );
  },
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, inputs, promptContext }) => {
      if (data.operation !== 'CREATE' && promptContext.targetMessage === undefined)
        throw new Error(`${data.operation} requires a target message`);
      const content = z.string().parse(inputs.content);
      return controlled({}, [{ type: 'VISIBLE_MESSAGE', operation: data.operation, content }]);
    },
  },
});
