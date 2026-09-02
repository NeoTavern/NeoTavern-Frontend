import { z } from 'zod';
import { defineTriggerNode, triggerDeclarationSchema, type EligibilityCondition } from '../../registry/node-definition';
import type { JsonObject } from '../../graph/contracts';
import { jsonObjectSchema } from '../../graph/schemas';
import { triggerEventSchemas, triggerFields, triggerPorts } from './shared';
type ManualData = { inputSchema: JsonObject; condition?: EligibilityCondition };
const manualDataSchema: z.ZodType<ManualData> = z
  .strictObject({
    inputSchema: jsonObjectSchema.refine((value) => value.type === 'object', 'must be an object schema'),
    condition: z.custom<EligibilityCondition>().optional(),
  })
  .superRefine((data, context) => {
    const result = triggerDeclarationSchema.safeParse({
      event: 'MANUAL',
      generationModes: [],
      schedule: { type: 'ALWAYS' },
      ...(data.condition ? { condition: data.condition } : {}),
    });
    if (!result.success)
      for (const issue of result.error.issues)
        context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });
export const manualNodeDefinition = defineTriggerNode<ManualData>({
  type: 'trigger.manual',
  labelKey: 'extensionsBuiltin.customAgents.nodes.manual.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.manual.description',
  category: 'TRIGGER',
  executionClass: 'CONTROLLED',
  dataSchema: manualDataSchema,
  initialData: () => ({ inputSchema: { type: 'object', additionalProperties: true } }),
  initialInputValues: () => ({}),
  ports: (data) => {
    const event = structuredClone(triggerEventSchemas['trigger.manual']!);
    if (event.properties && typeof event.properties === 'object' && !Array.isArray(event.properties))
      event.properties.input = data.inputSchema;
    const ports = triggerPorts('trigger.manual', [{ id: 'input', schema: data.inputSchema }]);
    const eventPort = ports.outputs.find((port) => port.id === 'event');
    if (eventPort && eventPort.kind === 'DATA') eventPort.schema = event;
    return ports;
  },
  fields: () => [
    { id: 'inputSchema', path: 'inputSchema', labelKey: 'inputSchema', control: 'JSON' },
    ...triggerFields(false).filter((field) => field.id === 'condition'),
  ],
  runtime: { kind: 'TRIGGER' },
  getTriggerDeclaration: (data) => ({
    event: 'MANUAL',
    generationModes: [],
    schedule: { type: 'ALWAYS' },
    ...(data.condition ? { condition: data.condition } : {}),
  }),
});
