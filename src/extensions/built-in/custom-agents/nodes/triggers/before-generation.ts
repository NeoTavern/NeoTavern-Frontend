import { defineTriggerNode } from '../../registry/node-definition';
import { generationTriggerDataSchema, modes, triggerFields, triggerPorts, type GenerationTriggerData } from './shared';
export const beforeGenerationNodeDefinition = defineTriggerNode<GenerationTriggerData>({
  type: 'trigger.before-generation',
  labelKey: 'extensionsBuiltin.customAgents.nodes.beforeGeneration.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.beforeGeneration.description',
  category: 'TRIGGER',
  executionClass: 'CONTROLLED',
  dataSchema: generationTriggerDataSchema,
  initialData: () => ({ generationModes: [...modes], schedule: { type: 'ALWAYS' } }),
  initialInputValues: () => ({}),
  ports: () =>
    triggerPorts('trigger.before-generation', [
      { id: 'generationMode', schema: { type: 'string', enum: [...modes] } },
      { id: 'targetMessage', schema: {} },
    ]),
  fields: (data) => triggerFields(true, data),
  runtime: { kind: 'TRIGGER' },
  getTriggerDeclaration: (data) => ({ event: 'BEFORE_GENERATION', ...data }),
});
