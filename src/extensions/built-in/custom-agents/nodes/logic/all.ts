import { z } from 'zod';
import { stableIdSchema } from '../../graph/schemas';
import { defineNode } from '../../registry/node-definition';
import { dataInput, dataOutput, pure } from '../shared';
const schema = z
  .strictObject({ inputs: z.array(z.strictObject({ id: stableIdSchema, label: z.string() })).min(1) })
  .superRefine((d, c) => {
    if (new Set(d.inputs.map((v) => v.id)).size !== d.inputs.length)
      c.addIssue({ code: 'custom', message: 'input IDs must be unique' });
  });
export const allNodeDefinition = defineNode({
  type: 'logic.all',
  labelKey: 'extensionsBuiltin.customAgents.nodes.all.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.all.description',
  category: 'LOGIC',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: ({ ids }) => ({ inputs: [{ id: ids.generate(), label: 'Value 1' }] }),
  initialInputValues: () => ({}),
  ports: (data) => ({
    inputs: data.inputs.map((v) =>
      dataInput(`value.${v.id}`, { type: 'boolean' }, true, undefined, v.label, undefined, true),
    ),
    outputs: [dataOutput('result', { type: 'boolean' })],
  }),
  fields: () => [
    {
      id: 'inputs',
      path: 'inputs',
      labelKey: 'inputs',
      control: 'REPEATER',
      minimum: 1,
      itemFields: [{ id: 'label', path: 'label', labelKey: 'label', control: 'INPUT' }],
    },
  ],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, inputs }) => pure({ result: data.inputs.every((v) => inputs[`value.${v.id}`] === true) }),
  },
});
