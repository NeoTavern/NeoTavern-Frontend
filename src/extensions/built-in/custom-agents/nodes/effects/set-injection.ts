import { z } from 'zod';
import { stableIdSchema } from '../../graph/schemas';
import { defineNode } from '../../registry/node-definition';
import { controlInput, controlOutput, controlled, dataInput } from '../shared';
const lifetime = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ONCE') }),
  z.strictObject({ type: z.literal('UNTIL_REMOVED') }),
  z.strictObject({ type: z.literal('FOR_N_GENERATIONS'), generations: z.number().int().positive() }),
]);
const activation = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ALWAYS') }),
  z.strictObject({ type: z.literal('PROBABILITY') }),
]);
const schema = z.strictObject({
  injectionId: stableIdSchema,
  placement: z.enum(['relative', 'in-chat']),
  depth: z.number().int().nonnegative(),
  lifetime,
  activation,
});
export const setInjectionNodeDefinition = defineNode<z.infer<typeof schema>>({
  type: 'effect.set-injection',
  labelKey: 'extensionsBuiltin.customAgents.nodes.setInjection.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.setInjection.description',
  category: 'EFFECT',
  executionClass: 'CONTROLLED',
  dataSchema: schema,
  initialData: ({ ids }) => ({
    injectionId: ids.generate(),
    placement: 'relative',
    depth: 0,
    lifetime: { type: 'UNTIL_REMOVED' },
    activation: { type: 'ALWAYS' },
  }),
  initialInputValues: () => ({}),
  ports: (data) => ({
    inputs: [
      controlInput(),
      dataInput('content', { type: 'string' }, true, 'TEXTAREA'),
      ...(data.activation.type === 'PROBABILITY'
        ? [dataInput('probability', { type: 'number', minimum: 0, maximum: 1 })]
        : []),
    ],
    outputs: [controlOutput()],
  }),
  fields: (data) => [
    { id: 'injectionId', path: 'injectionId', labelKey: 'injectionId', control: 'INPUT' },
    {
      id: 'placement',
      path: 'placement',
      labelKey: 'placement',
      control: 'SELECT',
      options: [
        { labelKey: 'relative', value: 'relative' },
        { labelKey: 'in-chat', value: 'in-chat' },
      ],
    },
    { id: 'depth', path: 'depth', labelKey: 'depth', control: 'NUMBER' },
    {
      id: 'lifetimeType',
      path: 'lifetime.type',
      labelKey: 'lifetimeType',
      control: 'SELECT',
      options: ['ONCE', 'UNTIL_REMOVED', 'FOR_N_GENERATIONS'].map((value) => ({ labelKey: value, value })),
    },
    ...(data.lifetime.type === 'FOR_N_GENERATIONS'
      ? [{ id: 'generations', path: 'lifetime.generations', labelKey: 'generations', control: 'NUMBER' as const }]
      : []),
    {
      id: 'activationType',
      path: 'activation.type',
      labelKey: 'activationType',
      control: 'SELECT',
      options: ['ALWAYS', 'PROBABILITY'].map((value) => ({ labelKey: value, value })),
    },
  ],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, inputs }) => {
      const content = z.string().parse(inputs.content);
      const resolvedActivation =
        data.activation.type === 'ALWAYS'
          ? data.activation
          : { type: 'PROBABILITY' as const, probability: z.number().min(0).max(1).parse(inputs.probability) };
      return controlled({}, [
        {
          type: 'INJECTION_SET',
          injectionId: data.injectionId,
          content,
          placement: data.placement,
          depth: data.depth,
          lifetime: data.lifetime,
          activation: resolvedActivation,
        },
      ]);
    },
  },
});
