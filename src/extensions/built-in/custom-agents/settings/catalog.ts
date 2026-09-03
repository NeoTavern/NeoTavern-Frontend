import mythic from '../presets/mythic.flow.json';
import type { GraphPreset } from '../graph/contracts';

// Director remains a test fixture and is never installed.
export const graphAgentTemplateDefinitions: readonly GraphPreset[] = [mythic as unknown as GraphPreset];

/** Returns editable clones while keeping checked-in catalog assets immutable. */
export function getGraphAgentTemplates(): GraphPreset[] {
  return graphAgentTemplateDefinitions.map((template) => structuredClone(template));
}
