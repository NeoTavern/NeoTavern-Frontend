import { z } from 'zod';
import { defineNode } from '../../registry/node-definition';
import { controlInput, controlOutput, dataInput, dataOutput } from '../shared';
const runFlowDataSchema = z.strictObject({ flowId: z.string() });
export const runFlowNodeDefinition = defineNode({
  type: 'control.run-flow',
  labelKey: 'extensionsBuiltin.customAgents.nodes.runFlow.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.runFlow.description',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: runFlowDataSchema,
  initialData: () => ({ flowId: '' }),
  initialInputValues: () => ({}),
  ports: (data, context) => {
    const signature = context.resolveSubflow(data.flowId);
    return {
      inputs: [
        controlInput(),
        ...(signature?.inputs ?? []).map((port) =>
          dataInput(port.id, port.schema, port.required, undefined, port.label, undefined, true),
        ),
      ],
      outputs: [
        controlOutput(),
        ...(signature?.outputs ?? []).map((port) => dataOutput(port.id, port.schema, port.required, port.label, true)),
      ],
    };
  },
  fields: () => [{ id: 'flowId', path: 'flowId', labelKey: 'flowId', control: 'SELECT', options: [] }],
  runtime: { kind: 'RUN_SUBFLOW' },
});
