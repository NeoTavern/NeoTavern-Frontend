import { z } from 'zod';
import { stableIdSchema } from '../../graph/schemas';
import { defineNode } from '../../registry/node-definition';
import { controlInput, controlOutput, controlled, dataInput } from '../shared';
const branchNodeDataSchema = z
  .strictObject({ cases: z.array(z.strictObject({ id: stableIdSchema, label: z.string() })).min(1) })
  .superRefine((data, ctx) => {
    if (new Set(data.cases.map((v) => v.id)).size !== data.cases.length)
      ctx.addIssue({ code: 'custom', path: ['cases'], message: 'case IDs must be unique' });
  });
export const branchNodeDefinition = defineNode({
  type: 'control.branch',
  labelKey: 'extensionsBuiltin.customAgents.nodes.branch.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.branch.description',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: branchNodeDataSchema,
  initialData: ({ ids }) => ({ cases: [{ id: ids.generate(), label: 'Case 1' }] }),
  initialInputValues: () => ({}),
  ports: (data) => ({
    inputs: [
      controlInput(),
      ...data.cases.map((item) =>
        dataInput(`condition.${item.id}`, { type: 'boolean' }, true, undefined, item.label, undefined, true),
      ),
    ],
    outputs: [...data.cases.map((item) => controlOutput(`case.${item.id}`, item.label, true)), controlOutput('else')],
  }),
  fields: () => [
    {
      id: 'cases',
      path: 'cases',
      labelKey: 'cases',
      control: 'REPEATER',
      minimum: 1,
      itemFields: [{ id: 'label', path: 'label', labelKey: 'label', control: 'INPUT' }],
    },
  ],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, inputs }) => {
      const selected = data.cases.find((item) => inputs[`condition.${item.id}`] === true);
      return controlled({}, [], [selected ? `case.${selected.id}` : 'else']);
    },
  },
});
