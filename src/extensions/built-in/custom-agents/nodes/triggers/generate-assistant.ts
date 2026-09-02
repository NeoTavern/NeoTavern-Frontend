import { defineTriggerNode } from '../../registry/node-definition';
import { generationTriggerDataSchema, modes, triggerFields, triggerPorts, type GenerationTriggerData } from './shared';
export const generateAssistantNodeDefinition = defineTriggerNode<GenerationTriggerData>({
  type: 'trigger.generate-assistant',
  labelKey: 'extensionsBuiltin.customAgents.nodes.generateAssistant.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.generateAssistant.description',
  category: 'TRIGGER',
  executionClass: 'CONTROLLED',
  dataSchema: generationTriggerDataSchema,
  initialData: () => ({ generationModes: [...modes], schedule: { type: 'ALWAYS' } }),
  initialInputValues: () => ({}),
  ports: () =>
    triggerPorts('trigger.generate-assistant', [
      { id: 'generationMode', schema: { type: 'string', enum: [...modes] } },
      { id: 'targetMessage', schema: {} },
    ]),
  fields: (data) => triggerFields(true, data),
  runtime: { kind: 'TRIGGER' },
  getTriggerDeclaration: (data) => ({ event: 'GENERATE_ASSISTANT', ...data }),
});
