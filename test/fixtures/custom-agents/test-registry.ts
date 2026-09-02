import { z } from 'zod';
import type { GraphPreset, JsonObject } from '../../../src/extensions/built-in/custom-agents/graph/contracts';
import { jsonObjectSchema, scopeGraphSchema } from '../../../src/extensions/built-in/custom-agents/graph/schemas';
import { schemaFromConstant } from '../../../src/extensions/built-in/custom-agents/graph/schema-ports';
import {
  defineNode,
  defineTriggerNode,
  type ControlPortDefinition,
  type DataPortDefinition,
} from '../../../src/extensions/built-in/custom-agents/registry/node-definition';
import { NodeRegistry } from '../../../src/extensions/built-in/custom-agents/registry/node-registry';

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
const dataInput = (id: string, schema: JsonObject, required = true): DataPortDefinition => ({
  id,
  direction: 'INPUT',
  kind: 'DATA',
  cardinality: 'ONE',
  required,
  schema,
  labelKey: id,
});
const dataOutput = (id: string, schema: JsonObject, required = true): DataPortDefinition => ({
  id,
  direction: 'OUTPUT',
  kind: 'DATA',
  cardinality: 'MANY',
  required,
  schema,
  labelKey: id,
});
const empty = z.strictObject({});
const noFields = () => [];
const noInputs = () => ({});

const trigger = defineTriggerNode({
  type: 'test.trigger',
  labelKey: 'trigger',
  descriptionKey: 'trigger',
  category: 'TRIGGER',
  executionClass: 'CONTROLLED',
  dataSchema: empty,
  initialData: () => ({}),
  initialInputValues: noInputs,
  ports: () => ({ inputs: [], outputs: [controlOutput(), dataOutput('event', { type: 'object' })] }),
  fields: noFields,
  runtime: { kind: 'TRIGGER' },
  getTriggerDeclaration: () => ({
    event: 'MANUAL',
    generationModes: [],
    schedule: { type: 'ALWAYS' },
  }),
});

const sourceData = z.strictObject({ schema: jsonObjectSchema, semanticOrder: z.array(z.string()).optional() });
const source = defineNode({
  type: 'test.source',
  labelKey: 'source',
  descriptionKey: 'source',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: sourceData,
  initialData: () => ({ schema: {} }),
  initialInputValues: noInputs,
  ports: (data) => ({ inputs: [], outputs: [dataOutput('value', data.schema)] }),
  fields: noFields,
  runtime: { kind: 'EXECUTOR', execute: async () => ({ control: [], outputs: {}, effects: [] }) },
});

const binding = defineNode({
  type: 'test.binding',
  labelKey: 'binding',
  descriptionKey: 'binding',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: empty,
  initialData: () => ({}),
  initialInputValues: noInputs,
  ports: (_data, context) => {
    const resolved = context.resolveInputBinding('value');
    const schema =
      resolved.kind === 'EDGE'
        ? resolved.source.schema
        : resolved.kind === 'INLINE'
          ? schemaFromConstant(resolved.value)
          : {};
    return { inputs: [dataInput('value', {}, false)], outputs: [dataOutput('result', schema)] };
  },
  fields: noFields,
  runtime: { kind: 'EXECUTOR', execute: async () => ({ control: [], outputs: {}, effects: [] }) },
});

const controlledData = z.strictObject({
  inputSchema: jsonObjectSchema.optional(),
  outputSchema: jsonObjectSchema.optional(),
});
const controlled = defineNode({
  type: 'test.controlled',
  labelKey: 'controlled',
  descriptionKey: 'controlled',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: controlledData,
  initialData: () => ({}),
  initialInputValues: noInputs,
  ports: (data) => ({
    inputs: [controlInput(), ...(data.inputSchema ? [dataInput('value', data.inputSchema)] : [])],
    outputs: [controlOutput(), ...(data.outputSchema ? [dataOutput('value', data.outputSchema)] : [])],
  }),
  fields: noFields,
  runtime: { kind: 'EXECUTOR', execute: async () => ({ control: [], outputs: {}, effects: [] }) },
});

const branch = defineNode({
  type: 'test.branch',
  labelKey: 'branch',
  descriptionKey: 'branch',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: empty,
  initialData: () => ({}),
  initialInputValues: noInputs,
  ports: () => ({ inputs: [controlInput()], outputs: [controlOutput('yes'), controlOutput('no')] }),
  fields: noFields,
  runtime: { kind: 'EXECUTOR', execute: async () => ({ control: [], outputs: {}, effects: [] }) },
});

const ordinaryFanIn = defineNode({
  type: 'test.fan-in',
  labelKey: 'fanIn',
  descriptionKey: 'fanIn',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: empty,
  initialData: () => ({}),
  initialInputValues: noInputs,
  ports: () => ({ inputs: [controlInput('left'), controlInput('right')], outputs: [controlOutput()] }),
  fields: noFields,
  runtime: { kind: 'EXECUTOR', execute: async () => ({ control: [], outputs: {}, effects: [] }) },
});

const mergeAny = defineNode({
  type: 'control.merge-any',
  labelKey: 'mergeAny',
  descriptionKey: 'mergeAny',
  category: 'CONTROL',
  executionClass: 'MERGE_ANY',
  dataSchema: empty,
  initialData: () => ({}),
  initialInputValues: noInputs,
  ports: () => ({ inputs: [controlInput('left'), controlInput('right')], outputs: [controlOutput()] }),
  fields: noFields,
  runtime: { kind: 'EXECUTOR', execute: async () => ({ control: [], outputs: {}, effects: [] }) },
});

const mergeAll = defineNode({
  ...mergeAny,
  type: 'control.merge-all',
  labelKey: 'mergeAll',
  descriptionKey: 'mergeAll',
  executionClass: 'MERGE_ALL',
});

const entry = defineNode({
  type: 'scope.entry',
  labelKey: 'entry',
  descriptionKey: 'entry',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: empty,
  initialData: () => ({}),
  initialInputValues: noInputs,
  ports: (_data, context) => ({
    inputs: [],
    outputs: [
      controlOutput(),
      ...(context.scopeSignature?.inputs.map((port) => dataOutput(port.id, port.schema, port.required)) ?? []),
    ],
  }),
  fields: noFields,
  runtime: { kind: 'SCOPE_ENTRY' },
});
const scopeReturn = defineNode({
  type: 'scope.return',
  labelKey: 'return',
  descriptionKey: 'return',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: empty,
  initialData: () => ({}),
  initialInputValues: noInputs,
  ports: (_data, context) => ({
    inputs: [
      controlInput(),
      ...(context.scopeSignature?.outputs.map((port) => dataInput(port.id, port.schema, port.required)) ?? []),
    ],
    outputs: [],
  }),
  fields: noFields,
  runtime: { kind: 'SCOPE_RETURN' },
});

const runFlow = defineNode({
  type: 'control.run-flow',
  labelKey: 'run',
  descriptionKey: 'run',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: z.strictObject({ flowId: z.string() }),
  initialData: () => ({ flowId: '' }),
  initialInputValues: noInputs,
  ports: (data, context) => {
    const signature = context.resolveSubflow(data.flowId);
    return {
      inputs: [
        controlInput(),
        ...(signature?.inputs.map((port) => dataInput(port.id, port.schema, port.required)) ?? []),
      ],
      outputs: [
        controlOutput(),
        ...(signature?.outputs.map((port) => dataOutput(port.id, port.schema, port.required)) ?? []),
      ],
    };
  },
  fields: noFields,
  runtime: { kind: 'RUN_SUBFLOW' },
});

const forEach = defineNode({
  type: 'control.for-each',
  labelKey: 'forEach',
  descriptionKey: 'forEach',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: z.strictObject({ accumulator: z.boolean(), body: scopeGraphSchema }),
  initialData: () => ({ accumulator: false, body: { nodes: [], edges: [] } }),
  initialInputValues: noInputs,
  ports: (data, context) => {
    const items = context.resolveInputBinding('items');
    const inputSchema =
      items.kind === 'EDGE'
        ? items.source.schema
        : items.kind === 'INLINE'
          ? schemaFromConstant(items.value)
          : { type: 'array' };
    const returned = context.resolveNestedReturnSource('value');
    const accumulator = context.resolveInputBinding('initialAccumulator');
    const accumulatorSchema =
      accumulator.kind === 'EDGE'
        ? accumulator.source.schema
        : accumulator.kind === 'INLINE'
          ? schemaFromConstant(accumulator.value)
          : {};
    return {
      inputs: [
        controlInput(),
        dataInput('items', { type: 'array' }),
        ...(data.accumulator ? [dataInput('initialAccumulator', {})] : []),
      ],
      outputs: [
        controlOutput(),
        dataOutput('items', {
          type: 'array',
          items:
            returned?.schema ??
            (inputSchema.items && typeof inputSchema.items === 'object' && !Array.isArray(inputSchema.items)
              ? inputSchema.items
              : {}),
        }),
        ...(data.accumulator ? [dataOutput('accumulator', accumulatorSchema)] : []),
      ],
    };
  },
  fields: noFields,
  runtime: { kind: 'FOR_EACH' },
});

const stop = defineNode({
  type: 'control.stop',
  labelKey: 'stop',
  descriptionKey: 'stop',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: empty,
  initialData: () => ({}),
  initialInputValues: noInputs,
  ports: () => ({ inputs: [controlInput()], outputs: [] }),
  fields: noFields,
  runtime: { kind: 'STOP' },
});

export function createTestRegistry(): NodeRegistry {
  return new NodeRegistry([
    trigger,
    source,
    binding,
    controlled,
    branch,
    ordinaryFanIn,
    mergeAny,
    mergeAll,
    entry,
    scopeReturn,
    runFlow,
    forEach,
    stop,
  ]);
}

export function basePreset(): GraphPreset {
  return {
    format: 'NEOTAVERN_CUSTOM_AGENT_FLOW',
    agent: {
      id: 'test-agent',
      name: 'Test',
      enabled: true,
      priority: 0,
      configurationSchema: { type: 'object', additionalProperties: false },
      configurationDefaults: {},
      stateSchema: { type: 'object', additionalProperties: false },
      initialState: {},
      views: [],
      flows: [
        {
          id: 'main',
          name: 'Main',
          kind: 'TRIGGER',
          inputs: [],
          outputs: [],
          nodes: [
            { id: 'trigger', type: 'test.trigger', position: { x: 0, y: 0 }, data: {}, inputValues: {} },
            { id: 'finish', type: 'test.controlled', position: { x: 100, y: 0 }, data: {}, inputValues: {} },
          ],
          edges: [
            {
              id: 'control',
              kind: 'CONTROL',
              source: { nodeId: 'trigger', portId: 'out' },
              target: { nodeId: 'finish', portId: 'in' },
            },
          ],
        },
      ],
    },
  };
}

export const node = (id: string, type: string, data: JsonObject = {}, inputValues: Record<string, never> = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data,
  inputValues,
});
export const edge = (
  id: string,
  kind: 'CONTROL' | 'DATA',
  sourceNode: string,
  sourcePort: string,
  targetNode: string,
  targetPort: string,
) => ({
  id,
  kind,
  source: { nodeId: sourceNode, portId: sourcePort },
  target: { nodeId: targetNode, portId: targetPort },
});
