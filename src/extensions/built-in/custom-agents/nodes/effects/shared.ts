import type { GraphDiagnostic } from '../../graph/diagnostics';
import { errorDiagnostic, nodeLocation } from '../../graph/diagnostics';
import type { NodeValidationContext, TriggerDeclaration } from '../../registry/node-definition';
import type { JsonObject } from '../../graph/contracts';

export function triggerDeclaration(context: NodeValidationContext<JsonObject>): TriggerDeclaration | undefined {
  const trigger = context.flow.nodes.find((node) => node.type.startsWith('trigger.'));
  if (!trigger) return undefined;
  const definition = context.registry.get(trigger.type);
  return definition?.runtime.kind === 'TRIGGER' ? definition.runtime.getTriggerDeclaration(trigger.data) : undefined;
}
export function nodeError(
  context: NodeValidationContext<JsonObject>,
  code: string,
  message: string,
): GraphDiagnostic[] {
  return [errorDiagnostic(code, message, nodeLocation(context.flow.id, context.node.id))];
}
