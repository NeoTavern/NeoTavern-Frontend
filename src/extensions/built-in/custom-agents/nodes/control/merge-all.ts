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
export const mergeAllNodeDefinition = defineNode({
  type: 'control.merge-all',
  labelKey: 'extensionsBuiltin.customAgents.nodes.mergeAll.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.mergeAll.description',
  category: 'CONTROL',
  executionClass: 'MERGE_ALL',
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
    outputs: [
      controlOutput(),
      dataOutput('values', {
        type: 'object',
        properties: Object.fromEntries(data.inputs.filter((v) => v.carriesValue).map((v) => [v.id, {}])),
        required: data.inputs.filter((v) => v.carriesValue).map((v) => v.id),
        additionalProperties: false,
      }),
    ],
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
    execute: async ({ data, inputs }) =>
      controlled({
        values: Object.fromEntries(
          data.inputs.filter((v) => v.carriesValue).map((v) => [v.id, inputs[`value.${v.id}`]!]),
        ),
      }),
  },
});
