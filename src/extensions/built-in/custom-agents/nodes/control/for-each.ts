import { z } from 'zod';
import { scopeGraphSchema } from '../../graph/schemas';
import { schemaFromConstant } from '../../graph/schema-ports';
import { defineNode, type NodePortContext } from '../../registry/node-definition';
import { controlInput, controlOutput, dataInput, dataOutput } from '../shared';
const schema = z.strictObject({ accumulator: z.boolean(), body: scopeGraphSchema });
function bindingSchema(context: NodePortContext, id: string) {
  const binding = context.resolveInputBinding(id);
  return binding.kind === 'EDGE'
    ? binding.source.schema
    : binding.kind === 'INLINE'
      ? schemaFromConstant(binding.value)
      : {};
}
export const forEachNodeDefinition = defineNode({
  type: 'control.for-each',
  labelKey: 'extensionsBuiltin.customAgents.nodes.forEach.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.forEach.description',
  category: 'CONTROL',
  executionClass: 'CONTROLLED',
  dataSchema: schema,
  initialData: ({ ids }) => {
    const entry = ids.generate(),
      returned = ids.generate();
    return {
      accumulator: false,
      body: {
        nodes: [
          { id: entry, type: 'scope.entry', position: { x: 0, y: 0 }, data: {}, inputValues: {} },
          { id: returned, type: 'scope.return', position: { x: 240, y: 0 }, data: {}, inputValues: {} },
        ],
        edges: [
          {
            id: ids.generate(),
            kind: 'CONTROL' as const,
            source: { nodeId: entry, portId: 'out' },
            target: { nodeId: returned, portId: 'in' },
          },
        ],
      },
    };
  },
  initialInputValues: () => ({}),
  ports: (data, context) => {
    const valueSource = context.resolveNestedReturnSource('value');
    const outputItems = { type: 'array', items: valueSource?.schema ?? {} };
    const accumulator = bindingSchema(context, 'initialAccumulator');
    return {
      inputs: [
        controlInput(),
        dataInput('items', { type: 'array' }),
        ...(data.accumulator ? [dataInput('initialAccumulator', {})] : []),
      ],
      outputs: [
        controlOutput(),
        dataOutput('items', outputItems),
        ...(data.accumulator ? [dataOutput('accumulator', accumulator)] : []),
      ],
    };
  },
  fields: () => [
    { id: 'accumulator', path: 'accumulator', labelKey: 'accumulator', control: 'TOGGLE' },
    { id: 'body', path: 'body', labelKey: 'body', control: 'SCOPE_EDITOR' },
  ],
  runtime: { kind: 'FOR_EACH' },
});
