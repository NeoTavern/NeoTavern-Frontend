import { defineTriggerNode } from '../../registry/node-definition';
import {
  messageValueJsonSchema,
  observerTriggerDataSchema,
  triggerFields,
  triggerPorts,
  type ObserverTriggerData,
} from './shared';

export const afterUserNodeDefinition = defineTriggerNode<ObserverTriggerData>({
  type: 'trigger.after-user',
  labelKey: 'extensionsBuiltin.customAgents.nodes.afterUser.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.afterUser.description',
  category: 'TRIGGER',
  executionClass: 'CONTROLLED',
  dataSchema: observerTriggerDataSchema,
  initialData: () => ({ schedule: { type: 'ALWAYS' } }),
  initialInputValues: () => ({}),
  ports: () => triggerPorts('trigger.after-user', [{ id: 'message', schema: messageValueJsonSchema }]),
  fields: (data) => triggerFields(false, data),
  runtime: { kind: 'TRIGGER' },
  getTriggerDeclaration: (data) => ({ event: 'AFTER_USER', generationModes: [], ...data }),
});
