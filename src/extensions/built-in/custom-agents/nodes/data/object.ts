import { z } from 'zod';
import { stableIdSchema, jsonObjectSchema } from '../../graph/schemas';
import { defineNode } from '../../registry/node-definition';
import type { JsonObject } from '../../graph/contracts';
import { dataInput, dataOutput, pure } from '../shared';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const schema = z
  .strictObject({
    fields: z.array(z.strictObject({ id: stableIdSchema, key: z.string().min(1), schema: jsonObjectSchema })),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.fields.map((v) => v.id)).size !== data.fields.length)
      ctx.addIssue({ code: 'custom', message: 'field IDs must be unique' });
    if (new Set(data.fields.map((v) => v.key)).size !== data.fields.length)
      ctx.addIssue({ code: 'custom', message: 'field keys must be unique' });
    data.fields.forEach((v, i) => {
      if (forbidden.has(v.key)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'key'], message: 'forbidden key' });
    });
  });
function objectSchema(data: { fields: Array<{ id: string; key: string; schema: JsonObject }> }): JsonObject {
  return {
    type: 'object',
    properties: Object.fromEntries(data.fields.map((v) => [v.key, v.schema])),
    required: data.fields.map((v) => v.key),
    additionalProperties: false,
  };
}
export const objectNodeDefinition = defineNode({
  type: 'data.object',
  labelKey: 'extensionsBuiltin.customAgents.nodes.object.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.object.description',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: () => ({ fields: [] }),
  initialInputValues: () => ({}),
  ports: (data) => ({
    inputs: data.fields.map((v) => dataInput(`field.${v.id}`, v.schema, true, undefined, v.key, undefined, true)),
    outputs: [
      dataOutput('value', objectSchema(data)),
      ...data.fields.map((v) => dataOutput(`field.${v.id}`, v.schema, true, v.key, true)),
    ],
  }),
  fields: () => [
    {
      id: 'fields',
      path: 'fields',
      labelKey: 'fields',
      control: 'REPEATER',
      minimum: 0,
      itemFields: [
        { id: 'key', path: 'key', labelKey: 'key', control: 'INPUT' },
        { id: 'schema', path: 'schema', labelKey: 'schema', control: 'JSON' },
      ],
    },
  ],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, inputs }) => {
      const value = Object.fromEntries(data.fields.map((v) => [v.key, structuredClone(inputs[`field.${v.id}`]!)]));
      return pure({
        value,
        ...Object.fromEntries(data.fields.map((v) => [`field.${v.id}`, structuredClone(inputs[`field.${v.id}`]!)])),
      });
    },
  },
});
