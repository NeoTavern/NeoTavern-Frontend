import { z } from 'zod';
import { stableIdSchema } from '../../graph/schemas';
import { defineNode } from '../../registry/node-definition';
import { controlInput, controlOutput, controlled, inputField } from '../shared';
const schema = z.strictObject({ injectionId: stableIdSchema });
export const removeInjectionNodeDefinition = defineNode({
  type: 'effect.remove-injection',
  labelKey: 'extensionsBuiltin.customAgents.nodes.removeInjection.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.removeInjection.description',
  category: 'EFFECT',
  executionClass: 'CONTROLLED',
  dataSchema: schema,
  initialData: ({ ids }) => ({ injectionId: ids.generate() }),
  initialInputValues: () => ({}),
  ports: () => ({ inputs: [controlInput()], outputs: [controlOutput()] }),
  fields: () => [inputField('injectionId')],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data }) => controlled({}, [{ type: 'INJECTION_REMOVE', injectionId: data.injectionId }]),
  },
});
