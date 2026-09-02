import { defineNode } from '../../registry/node-definition';
import { dataInput, dataOutput, deepEqual, emptyDataSchema, noFields, noInputValues, pure } from '../shared';
export const inNodeDefinition = defineNode({
  type: 'logic.in',
  labelKey: 'extensionsBuiltin.customAgents.nodes.in.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.in.description',
  category: 'LOGIC',
  executionClass: 'PURE_DATA',
  dataSchema: emptyDataSchema,
  initialData: () => ({}),
  initialInputValues: noInputValues,
  ports: () => ({
    inputs: [dataInput('value', {}), dataInput('collection', { type: 'array' })],
    outputs: [dataOutput('result', { type: 'boolean' })],
  }),
  fields: noFields,
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ inputs }) => {
      if (!Array.isArray(inputs.collection)) throw new Error('Collection must be an array');
      return pure({ result: inputs.collection.some((value) => deepEqual(inputs.value!, value)) });
    },
  },
});
