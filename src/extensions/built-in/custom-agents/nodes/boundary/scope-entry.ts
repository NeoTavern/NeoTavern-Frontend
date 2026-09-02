import { defineNode } from '../../registry/node-definition';
import { controlOutput, dataOutput, emptyDataSchema, noFields, noInputValues } from '../shared';
export const scopeEntryNodeDefinition = defineNode({
  type: 'scope.entry',
  labelKey: 'extensionsBuiltin.customAgents.nodes.scopeEntry.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.scopeEntry.description',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: emptyDataSchema,
  initialData: () => ({}),
  initialInputValues: noInputValues,
  ports: (_data, context) => ({
    inputs: [],
    outputs: [
      controlOutput(),
      ...(context.scopeSignature?.inputs ?? []).map((port) =>
        dataOutput(port.id, port.schema, port.required, port.label, context.scopeSignatureKind === 'AUTHORED'),
      ),
    ],
  }),
  fields: noFields,
  runtime: { kind: 'SCOPE_ENTRY' },
});
