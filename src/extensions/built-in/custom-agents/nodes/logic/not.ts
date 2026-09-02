import { defineNode } from '../../registry/node-definition';
import { dataInput, dataOutput, emptyDataSchema, noFields, noInputValues, pure } from '../shared';
export const notNodeDefinition = defineNode({
  type: 'logic.not',
  labelKey: 'extensionsBuiltin.customAgents.nodes.not.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.not.description',
  category: 'LOGIC',
  executionClass: 'PURE_DATA',
  dataSchema: emptyDataSchema,
  initialData: () => ({}),
  initialInputValues: noInputValues,
  ports: () => ({
    inputs: [dataInput('value', { type: 'boolean' })],
    outputs: [dataOutput('result', { type: 'boolean' })],
  }),
  fields: noFields,
  runtime: { kind: 'EXECUTOR', execute: async ({ inputs }) => pure({ result: !inputs.value }) },
});
