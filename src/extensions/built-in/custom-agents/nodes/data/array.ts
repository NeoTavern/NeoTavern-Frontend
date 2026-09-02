import { z } from 'zod';
import { stableIdSchema } from '../../graph/schemas';
import { schemaFromConstant, schemasCanonicallyEqual } from '../../graph/schema-ports';
import { defineNode } from '../../registry/node-definition';
import type { JsonObject } from '../../graph/contracts';
import { dataInput, dataOutput, pure } from '../shared';
const schema = z
  .strictObject({ items: z.array(z.strictObject({ id: stableIdSchema, label: z.string() })) })
  .superRefine((data, ctx) => {
    if (new Set(data.items.map((v) => v.id)).size !== data.items.length)
      ctx.addIssue({ code: 'custom', message: 'item IDs must be unique' });
  });
export const arrayNodeDefinition = defineNode({
  type: 'data.array',
  labelKey: 'extensionsBuiltin.customAgents.nodes.array.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.array.description',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: () => ({ items: [] }),
  initialInputValues: () => ({}),
  ports: (data, context) => {
    const schemas = data.items.map((item) => {
      const binding = context.resolveInputBinding(`item.${item.id}`);
      return binding.kind === 'EDGE'
        ? binding.source.schema
        : binding.kind === 'INLINE'
          ? schemaFromConstant(binding.value)
          : {};
    });
    const itemSchema: JsonObject =
      schemas.length > 0 && schemas.every((v) => schemasCanonicallyEqual(v, schemas[0]!)) ? schemas[0]! : {};
    return {
      inputs: data.items.map((item) => dataInput(`item.${item.id}`, {}, true, undefined, item.label, undefined, true)),
      outputs: [dataOutput('value', { type: 'array', items: itemSchema })],
    };
  },
  fields: () => [
    {
      id: 'items',
      path: 'items',
      labelKey: 'items',
      control: 'REPEATER',
      minimum: 0,
      itemFields: [{ id: 'label', path: 'label', labelKey: 'label', control: 'INPUT' }],
    },
  ],
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, inputs }) =>
      pure({ value: data.items.map((item) => structuredClone(inputs[`item.${item.id}`]!)) }),
  },
});
