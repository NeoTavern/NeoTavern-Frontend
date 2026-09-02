import { z } from 'zod';
import { defineNode } from '../../registry/node-definition';
import {
  controlInput,
  controlOutput,
  controlled,
  dataInput,
  emptyDataSchema,
  noFields,
  noInputValues,
} from '../shared';
import { triggerDeclaration, nodeError } from './shared';
export const generationResponseNodeDefinition = defineNode({
  type: 'effect.generation-response',
  labelKey: 'extensionsBuiltin.customAgents.nodes.generationResponse.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.generationResponse.description',
  category: 'EFFECT',
  executionClass: 'CONTROLLED',
  dataSchema: emptyDataSchema,
  initialData: () => ({}),
  initialInputValues: noInputValues,
  ports: () => ({
    inputs: [controlInput(), dataInput('content', { type: 'string' }, true, 'TEXTAREA')],
    outputs: [controlOutput()],
  }),
  fields: noFields,
  validate: (context) =>
    triggerDeclaration(context)?.event === 'GENERATE_ASSISTANT' &&
    context.flow.nodes.some((node) => node.id === context.node.id)
      ? []
      : nodeError(
          context,
          'GENERATION_RESPONSE_CONTEXT',
          'Generation response is valid only at the top level of an assistant-generation flow',
        ),
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ inputs }) =>
      controlled({}, [{ type: 'GENERATION_RESPONSE', content: z.string().parse(inputs.content) }]),
  },
});
