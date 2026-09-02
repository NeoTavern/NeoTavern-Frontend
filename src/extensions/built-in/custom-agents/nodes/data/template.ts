import { z } from 'zod';
import { stableIdSchema } from '../../graph/schemas';
import { defineNode } from '../../registry/node-definition';
import { dataInput, dataOutput, pure } from '../shared';
const name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const schema = z
  .strictObject({ template: z.string(), variables: z.array(z.strictObject({ id: stableIdSchema, name })) })
  .superRefine((data, ctx) => {
    if (new Set(data.variables.map((v) => v.id)).size !== data.variables.length)
      ctx.addIssue({ code: 'custom', message: 'variable IDs must be unique' });
    if (new Set(data.variables.map((v) => v.name)).size !== data.variables.length)
      ctx.addIssue({ code: 'custom', message: 'variable names must be unique' });
  });
export const templateNodeDefinition = defineNode({
  type: 'data.template',
  labelKey: 'extensionsBuiltin.customAgents.nodes.template.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.template.description',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: () => ({ template: '', variables: [] }),
  initialInputValues: () => ({}),
  ports: (data) => ({
    inputs: data.variables.map((v) => dataInput(`variable.${v.id}`, {}, true, undefined, v.name, undefined, true)),
    outputs: [dataOutput('value', { type: 'string' })],
  }),
  fields: () => [
    { id: 'template', path: 'template', labelKey: 'template', control: 'TEXTAREA' },
    {
      id: 'variables',
      path: 'variables',
      labelKey: 'variables',
      control: 'REPEATER',
      minimum: 0,
      itemFields: [{ id: 'name', path: 'name', labelKey: 'name', control: 'INPUT' }],
    },
  ],
  runtime: {
    kind: 'EXECUTOR',
    execute: async (context) => {
      context.signal.throwIfAborted();
      const value = await context.templates.render({
        template: context.data.template,
        variables: Object.fromEntries(context.data.variables.map((v) => [v.name, context.inputs[`variable.${v.id}`]!])),
        event: context.event,
        configuration: context.configuration,
        state: context.state,
        ...(context.iteration ? { iteration: context.iteration } : {}),
        promptContext: context.promptContext,
        signal: context.signal,
      });
      context.signal.throwIfAborted();
      return pure({ value });
    },
  },
});
