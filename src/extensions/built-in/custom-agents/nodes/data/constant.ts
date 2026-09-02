import { z } from 'zod';
import { jsonValueSchema } from '../../graph/schemas';
import { schemaFromConstant } from '../../graph/schema-ports';
import { defineNode } from '../../registry/node-definition';
import { dataOutput, jsonField, pure } from '../shared';
const schema = z.strictObject({ value: jsonValueSchema });
export const constantNodeDefinition = defineNode({
  type: 'data.constant',
  labelKey: 'extensionsBuiltin.customAgents.nodes.constant.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.constant.description',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: () => ({ value: null }),
  initialInputValues: () => ({}),
  ports: (data) => ({ inputs: [], outputs: [dataOutput('value', schemaFromConstant(data.value))] }),
  fields: () => [jsonField('value')],
  runtime: { kind: 'EXECUTOR', execute: async ({ data }) => pure({ value: structuredClone(data.value) }) },
});
