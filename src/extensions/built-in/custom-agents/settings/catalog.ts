import mythic from '../presets/mythic.flow.json';
import narrativeMomentumDirector from '../presets/narrative-momentum-director.flow.json';
import scoredRoleplayQualityGate from '../presets/scored-roleplay-quality-gate.flow.json';
import sequentialRoleplayResponseEditor from '../presets/sequential-roleplay-response-editor.flow.json';
import type { GraphPreset } from '../graph/contracts';

export const graphAgentTemplateDefinitions: readonly GraphPreset[] = [
  mythic as unknown as GraphPreset,
  narrativeMomentumDirector as unknown as GraphPreset,
  sequentialRoleplayResponseEditor as unknown as GraphPreset,
  scoredRoleplayQualityGate as unknown as GraphPreset,
];

/** Returns editable clones while keeping checked-in catalog assets immutable. */
export function getGraphAgentTemplates(): GraphPreset[] {
  return graphAgentTemplateDefinitions.map((template) => structuredClone(template));
}
