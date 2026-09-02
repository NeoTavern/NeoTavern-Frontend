import { defineNode } from '../../registry/node-definition';
import { controlInput, emptyDataSchema, noFields, noInputValues } from '../shared';
export const stopNodeDefinition = defineNode({
  type: 'control.stop',
  labelKey: 'extensionsBuiltin.customAgents.nodes.stop.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.stop.description',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: emptyDataSchema,
  initialData: () => ({}),
  initialInputValues: noInputValues,
  ports: () => ({ inputs: [controlInput()], outputs: [] }),
  fields: noFields,
  runtime: { kind: 'STOP' },
});
