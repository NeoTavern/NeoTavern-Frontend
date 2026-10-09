import { z } from 'zod';
import type { JsonObject, JsonValue } from '../../graph/contracts';
import { errorDiagnostic, nodeLocation } from '../../graph/diagnostics';
import { jsonObjectSchema, jsonValueSchema, stableIdSchema } from '../../graph/schemas';
import { defineNode } from '../../registry/node-definition';
import { dataInput, projectValue, projectedOutputs, pure, validateJson } from '../shared';

const inputName = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, 'must be a JavaScript identifier');

type JavascriptInput = { id: string; name: string; schema: JsonObject };
type JavascriptRunner = (inputs: Readonly<Record<string, JsonValue>>) => unknown;

function compile(code: string): JavascriptRunner {
  return new Function('inputs', `"use strict";\n${code}`) as JavascriptRunner;
}

const schema = z
  .strictObject({
    code: z.string(),
    inputs: z.array(z.strictObject({ id: stableIdSchema, name: inputName, schema: jsonObjectSchema })),
    outputSchema: jsonObjectSchema,
  })
  .superRefine((data, context) => {
    if (new Set(data.inputs.map((input) => input.id)).size !== data.inputs.length)
      context.addIssue({ code: 'custom', message: 'input IDs must be unique' });
    if (new Set(data.inputs.map((input) => input.name)).size !== data.inputs.length)
      context.addIssue({ code: 'custom', message: 'input names must be unique' });
  });

function freezeJson(value: JsonValue): JsonValue {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) freezeJson(nested);
    Object.freeze(value);
  }
  return value;
}

function runtimeInputs(inputs: readonly JavascriptInput[], values: Readonly<Record<string, JsonValue>>) {
  return Object.freeze(
    Object.fromEntries(inputs.map((input) => [input.name, freezeJson(structuredClone(values[`input.${input.id}`]!))])),
  );
}

export const javascriptNodeDefinition = defineNode({
  type: 'data.javascript',
  labelKey: 'extensionsBuiltin.customAgents.nodes.javascript.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.javascript.description',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: schema,
  initialData: () => ({ code: 'return null;', inputs: [], outputSchema: {} }),
  initialInputValues: () => ({}),
  ports: (data) => ({
    inputs: data.inputs.map((input) =>
      dataInput(`input.${input.id}`, input.schema, true, undefined, input.name, undefined, true),
    ),
    outputs: projectedOutputs('value', data.outputSchema),
  }),
  fields: () => [
    { id: 'code', path: 'code', labelKey: 'code', control: 'TEXTAREA', rows: 10, allowMaximize: true },
    {
      id: 'inputs',
      path: 'inputs',
      labelKey: 'inputs',
      control: 'REPEATER',
      minimum: 0,
      itemFields: [
        { id: 'name', path: 'name', labelKey: 'name', control: 'INPUT' },
        { id: 'schema', path: 'schema', labelKey: 'schema', control: 'JSON' },
      ],
    },
    { id: 'outputSchema', path: 'outputSchema', labelKey: 'outputSchema', control: 'JSON' },
  ],
  validate: ({ flow, node }) => {
    try {
      compile(node.data.code);
      return [];
    } catch (error) {
      return [
        errorDiagnostic(
          'JAVASCRIPT_SYNTAX',
          `Invalid JavaScript: ${error instanceof Error ? error.message : String(error)}`,
          nodeLocation(flow.id, node.id),
        ),
      ];
    }
  },
  runtime: {
    kind: 'EXECUTOR',
    execute: async ({ data, inputs, signal }) => {
      signal.throwIfAborted();
      const result = compile(data.code)(runtimeInputs(data.inputs, inputs));
      if (result instanceof Promise) throw new Error('JavaScript nodes must return synchronously');
      const json = jsonValueSchema.parse(result);
      const value = validateJson(data.outputSchema, json, 'JavaScript output');
      signal.throwIfAborted();
      return pure(projectValue('value', value, data.outputSchema));
    },
  },
});
