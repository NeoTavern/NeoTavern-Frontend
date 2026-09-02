import { z } from 'zod';
import { jsonValueSchema } from '../../../src/extensions/built-in/custom-agents/graph/schemas';
import {
  defineNode,
  defineTriggerNode,
  type ControlPortDefinition,
  type DataPortDefinition,
  type GraphNodeEffect,
} from '../../../src/extensions/built-in/custom-agents/registry/node-definition';
import { NodeRegistry } from '../../../src/extensions/built-in/custom-agents/registry/node-registry';
import { createTestRegistry } from './test-registry';

const controlInput = (id = 'in'): ControlPortDefinition => ({
  id,
  direction: 'INPUT',
  kind: 'CONTROL',
  cardinality: 'ONE',
  labelKey: id,
});
const controlOutput = (id = 'out'): ControlPortDefinition => ({
  id,
  direction: 'OUTPUT',
  kind: 'CONTROL',
  cardinality: 'MANY',
  labelKey: id,
});
const dataInput = (id: string, schema = {}, required = true): DataPortDefinition => ({
  id,
  direction: 'INPUT',
  kind: 'DATA',
  cardinality: 'ONE',
  required,
  schema,
  labelKey: id,
});
const dataOutput = (id: string, schema = {}, required = true): DataPortDefinition => ({
  id,
  direction: 'OUTPUT',
  kind: 'DATA',
  cardinality: 'MANY',
  required,
  schema,
  labelKey: id,
});
const noFields = () => [];
const noInputs = () => ({});

export type RuntimeRegistryOptions = {
  record?: (label: string) => void;
  cancel?: () => void;
  wait?: (label: string) => Promise<void>;
};

export function createRuntimeRegistry(options: RuntimeRegistryOptions = {}): NodeRegistry {
  const actionData = z.strictObject({
    label: z.string(),
    control: z.array(z.enum(['out', 'left', 'right', 'skip'])).default(['out']),
    value: jsonValueSchema.optional(),
    omitValue: z.boolean().optional(),
    effect: z.enum(['NONE', 'STATE', 'BAD', 'RESPONSE']).default('NONE'),
    outputSchema: z.record(z.string(), jsonValueSchema).optional(),
  });
  const action = defineNode({
    type: 'test.runtime-action',
    labelKey: 'action',
    descriptionKey: 'action',
    category: 'CONTROL',
    executionClass: 'CONTROLLED',
    dataSchema: actionData,
    initialData: () => ({ label: '', control: ['out'], effect: 'NONE' }),
    initialInputValues: noInputs,
    ports: (data) => ({
      inputs: [controlInput()],
      outputs: [
        controlOutput(),
        controlOutput('left'),
        controlOutput('right'),
        controlOutput('skip'),
        dataOutput('value', data.outputSchema ?? {}, data.outputSchema !== undefined),
      ],
    }),
    fields: noFields,
    runtime: {
      kind: 'EXECUTOR',
      execute: async ({ data }) => {
        options.record?.(data.label);
        if (data.label === 'cancel') options.cancel?.();
        await options.wait?.(data.label);
        const effects: GraphNodeEffect[] =
          data.effect === 'STATE'
            ? [{ type: 'STATE_SET', path: 'count', value: data.value ?? 0 }]
            : data.effect === 'RESPONSE'
              ? [{ type: 'GENERATION_RESPONSE', content: String(data.value ?? '') }]
              : data.effect === 'BAD'
                ? ([{ type: 'UNKNOWN' }] as never)
                : [];
        return {
          control: data.control,
          outputs: data.omitValue || data.value === undefined ? {} : { value: data.value },
          effects,
        };
      },
    },
  });

  const pure = defineNode({
    type: 'test.runtime-pure',
    labelKey: 'pure',
    descriptionKey: 'pure',
    category: 'DATA',
    executionClass: 'PURE_DATA',
    dataSchema: z.strictObject({
      label: z.string(),
      value: jsonValueSchema,
      schema: z.record(z.string(), jsonValueSchema),
    }),
    initialData: () => ({ label: '', value: null, schema: {} }),
    initialInputValues: noInputs,
    ports: (data) => ({ inputs: [], outputs: [dataOutput('value', data.schema)] }),
    fields: noFields,
    runtime: {
      kind: 'EXECUTOR',
      execute: async ({ data }) => {
        options.record?.(data.label);
        return { control: [], outputs: { value: data.value }, effects: [] };
      },
    },
  });

  const consume = defineNode({
    type: 'test.runtime-consume',
    labelKey: 'consume',
    descriptionKey: 'consume',
    category: 'CONTROL',
    executionClass: 'CONTROLLED',
    dataSchema: z.strictObject({ label: z.string(), schema: z.record(z.string(), jsonValueSchema) }),
    initialData: () => ({ label: '', schema: {} }),
    initialInputValues: noInputs,
    ports: (data) => ({ inputs: [controlInput(), dataInput('value', data.schema)], outputs: [controlOutput()] }),
    fields: noFields,
    runtime: {
      kind: 'EXECUTOR',
      execute: async ({ data }) => {
        options.record?.(data.label);
        return { control: ['out'], outputs: {}, effects: [] };
      },
    },
  });

  const iteration = defineNode({
    type: 'test.runtime-iteration',
    labelKey: 'iteration',
    descriptionKey: 'iteration',
    category: 'CONTROL',
    executionClass: 'CONTROLLED',
    dataSchema: z.strictObject({ omitFirst: z.boolean().default(false) }),
    initialData: () => ({ omitFirst: false }),
    initialInputValues: noInputs,
    ports: () => ({
      inputs: [controlInput(), dataInput('item', { type: 'number' }), dataInput('accumulator', { type: 'number' })],
      outputs: [
        controlOutput(),
        dataOutput('value', { type: 'number' }, false),
        dataOutput('accumulator', { type: 'number' }),
      ],
    }),
    fields: noFields,
    runtime: {
      kind: 'EXECUTOR',
      execute: async ({ data, inputs, iteration: current }) => {
        const accumulator = Number(inputs.accumulator) + Number(inputs.item);
        return {
          control: ['out'],
          outputs: {
            ...(data.omitFirst && current?.index === 0 ? {} : { value: accumulator }),
            accumulator,
          },
          effects: [],
        };
      },
    },
  });

  const generator = defineTriggerNode({
    type: 'test.generator-trigger',
    labelKey: 'generator',
    descriptionKey: 'generator',
    category: 'TRIGGER',
    executionClass: 'CONTROLLED',
    dataSchema: z.strictObject({}),
    initialData: () => ({}),
    initialInputValues: noInputs,
    ports: () => ({ inputs: [], outputs: [controlOutput(), dataOutput('event', { type: 'object' })] }),
    fields: noFields,
    runtime: { kind: 'TRIGGER' },
    getTriggerDeclaration: () => ({
      event: 'GENERATE_ASSISTANT',
      generationModes: ['NEW'],
      schedule: { type: 'ALWAYS' },
    }),
  });

  const base = createTestRegistry()
    .list()
    .map((definition) =>
      definition.executionClass === 'MERGE_ANY' || definition.executionClass === 'MERGE_ALL'
        ? {
            ...definition,
            runtime: {
              kind: 'EXECUTOR' as const,
              execute: async () => ({ control: ['out'], outputs: {}, effects: [] }),
            },
          }
        : definition,
    );
  return new NodeRegistry([...base, action, pure, consume, iteration, generator]);
}
