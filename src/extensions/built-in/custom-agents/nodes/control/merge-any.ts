import { z } from 'zod';
import { stableIdSchema } from '../../graph/schemas';
import { defineNode } from '../../registry/node-definition';
import { controlInput, controlOutput, controlled, dataInput, dataOutput } from '../shared';
const schema = z
  .strictObject({
    inputs: z.array(z.strictObject({ id: stableIdSchema, label: z.string(), carriesValue: z.boolean() })).min(2),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.inputs.map((v) => v.id)).size !== data.inputs.length)
      ctx.addIssue({ code: 'custom', message: 'input IDs must be unique' });
  });
export const mergeAnyNodeDefinition = defineNode({
  type: 'control.merge-any',
  labelKey: 'extensionsBuiltin.customAgents.nodes.mergeAny.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.mergeAny.description',
  category: 'CONTROL',
  executionClass: 'MERGE_ANY',
  dataSchema: schema,
  initialData: ({ ids }) => ({
    inputs: [
      { id: ids.generate(), label: 'Input 1', carriesValue: false },
      { id: ids.generate(), label: 'Input 2', carriesValue: false },
    ],
  }),
  initialInputValues: () => ({}),
  ports: (data) => ({
    inputs: data.inputs.flatMap((item) => [
      controlInput(`in.${item.id}`, item.label, true),
      ...(item.carriesValue ? [dataInput(`value.${item.id}`, {}, true, undefined, item.label, undefined, true)] : []),
    ]),
    outputs: [controlOutput(), ...(data.inputs.some((v) => v.carriesValue) ? [dataOutput('value', {}, false)] : [])],
  }),
  fields: () => [
    {
      id: 'inputs',
      path: 'inputs',
      labelKey: 'inputs',
      control: 'REPEATER',
      minimum: 2,
      itemFields: [
        { id: 'label', path: 'label', labelKey: 'label', control: 'INPUT' },
        { id: 'carriesValue', path: 'carriesValue', labelKey: 'carriesValue', control: 'TOGGLE' },
      ],
    },
  ],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ inputs }) => {
      const value = Object.entries(inputs).find(([key]) => key.startsWith('value.'));
      return controlled(value ? { value: value[1] } : {});
    },
  },
});
