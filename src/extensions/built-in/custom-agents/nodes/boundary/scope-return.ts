import { defineNode } from '../../registry/node-definition';
import { controlInput, dataInput, emptyDataSchema, noFields, noInputValues } from '../shared';
export const scopeReturnNodeDefinition = defineNode({
  type: 'scope.return',
  labelKey: 'extensionsBuiltin.customAgents.nodes.scopeReturn.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.scopeReturn.description',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: emptyDataSchema,
  initialData: () => ({}),
  initialInputValues: noInputValues,
  ports: (_data, context) => ({
    inputs: [
      controlInput(),
      ...(context.scopeSignature?.outputs ?? []).map((port) =>
        dataInput(
          port.id,
          port.schema,
          port.required,
          undefined,
          port.label,
          undefined,
          context.scopeSignatureKind === 'AUTHORED',
        ),
      ),
    ],
    outputs: [],
  }),
  fields: noFields,
  runtime: { kind: 'SCOPE_RETURN' },
});
