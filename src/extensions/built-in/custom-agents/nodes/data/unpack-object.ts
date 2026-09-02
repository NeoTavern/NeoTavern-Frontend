import { defineNode } from '../../registry/node-definition';
import { errorDiagnostic, nodeLocation } from '../../graph/diagnostics';
import { dataInput, emptyDataSchema, noFields, noInputValues, projectedOutputs, pure } from '../shared';
export const unpackObjectNodeDefinition = defineNode({
  type: 'data.unpack-object',
  labelKey: 'extensionsBuiltin.customAgents.nodes.unpackObject.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.unpackObject.description',
  category: 'DATA',
  executionClass: 'PURE_DATA',
  dataSchema: emptyDataSchema,
  initialData: () => ({}),
  initialInputValues: noInputValues,
  ports: (_data, context) => {
    const binding = context.resolveInputBinding('value');
    const source = binding.kind === 'EDGE' ? binding.source.schema : {};
    return { inputs: [dataInput('value', { type: 'object' })], outputs: projectedOutputs('value', source) };
  },
  fields: noFields,
  validate: (context) => {
    const schema = context.ports.outputs
      .filter((port) => port.kind === 'DATA')
      .find((port) => port.id === 'value')?.schema;
    return schema?.type === 'object' &&
      schema.properties &&
      typeof schema.properties === 'object' &&
      !Array.isArray(schema.properties)
      ? []
      : [
          errorDiagnostic(
            'UNPACK_SCHEMA',
            'Object unpacking requires a connected explicit object properties schema',
            nodeLocation(context.flow.id, context.node.id),
          ),
        ];
  },
  runtime: { kind: 'EXECUTOR', execute: async ({ inputs }) => pure({ value: structuredClone(inputs.value!) }) },
});
