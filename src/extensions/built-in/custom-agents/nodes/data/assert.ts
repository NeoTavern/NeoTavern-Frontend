import { z } from 'zod';
import { jsonObjectSchema } from '../../graph/schemas';
import { defineNode } from '../../registry/node-definition';
import type { JsonObject } from '../../graph/contracts';
import { dataInput, jsonField, projectedOutputs, pure, validateJson } from '../shared';
const schema = z.strictObject({ schema: jsonObjectSchema });
export const assertNodeDefinition = defineNode<{ schema: JsonObject }>({
  type: 'data.assert',
  labelKey: 'extensionsBuiltin.customAgents.nodes.assert.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.assert.description',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: () => ({ schema: {} }),
  initialInputValues: () => ({}),
  ports: (data) => ({ inputs: [dataInput('value', {})], outputs: projectedOutputs('value', data.schema) }),
  fields: () => [jsonField('schema')],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, inputs }) => pure({ value: validateJson(data.schema, inputs.value!, 'Asserted value') }),
  },
});
