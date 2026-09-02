import { z } from 'zod';
import { defineNode } from '../../registry/node-definition';
import { dataInput, dataOutput, pathExists, pure } from '../shared';
import { isSafePath } from '../../generic/path';
const schema = z.strictObject({
  path: z
    .string()
    .nullable()
    .refine((v) => v === null || isSafePath(v), 'must be a safe path'),
});
export const existsNodeDefinition = defineNode({
  type: 'logic.exists',
  labelKey: 'extensionsBuiltin.customAgents.nodes.exists.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.exists.description',
  category: 'LOGIC',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: () => ({ path: null }),
  initialInputValues: () => ({}),
  ports: () => ({ inputs: [dataInput('value', {})], outputs: [dataOutput('result', { type: 'boolean' })] }),
  fields: () => [{ id: 'path', path: 'path', labelKey: 'path', control: 'INPUT' }],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, inputs }) => pure({ result: pathExists(inputs.value!, data.path) }),
  },
});
