import { defineTriggerNode } from '../../registry/node-definition';
import {
  generationTriggerDataSchema,
  messageValueJsonSchema,
  modes,
  triggerFields,
  triggerPorts,
  type GenerationTriggerData,
} from './shared';
export const afterGenerationNodeDefinition = defineTriggerNode<GenerationTriggerData>({
  type: 'trigger.after-generation',
  labelKey: 'extensionsBuiltin.customAgents.nodes.afterGeneration.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.afterGeneration.description',
  category: 'TRIGGER',
  executionClass: 'CONTROLLED',
  dataSchema: generationTriggerDataSchema,
  initialData: () => ({ generationModes: [...modes], schedule: { type: 'ALWAYS' } }),
  initialInputValues: () => ({}),
  ports: () =>
    triggerPorts('trigger.after-generation', [
      { id: 'generationMode', schema: { type: 'string', enum: [...modes] } },
      { id: 'message', schema: messageValueJsonSchema },
    ]),
  fields: (data) => triggerFields(true, data),
  runtime: { kind: 'TRIGGER' },
  getTriggerDeclaration: (data) => ({ event: 'AFTER_GENERATION', ...data }),
});
