import mythic from '../presets/mythic.flow.json';
import type { GraphPreset } from '../graph/contracts';
import { validateInstalledPreset } from './store';

function deepFreeze(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  Object.freeze(value);
}

// Director remains a test fixture and is never installed.
const templates: readonly GraphPreset[] = [validateInstalledPreset(mythic)];
deepFreeze(templates);

/** Returns editable clones while keeping checked-in catalog assets immutable. */
export function getGraphAgentTemplates(): GraphPreset[] {
  return templates.map((template) => structuredClone(template));
}
