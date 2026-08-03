import { cloneDeep } from 'lodash-es';
import type { SamplerSettings } from '../types/settings';

export function normalizeStopSequences(stop: string[] | undefined): string[] | undefined {
  if (!stop) return undefined;

  const stops = stop.filter((x) => typeof x === 'string' && x.trim().length > 0);
  return stops.length > 0 ? Array.from(new Set(stops)) : [];
}

export function normalizeSamplerSettings<T extends Partial<SamplerSettings>>(settings: T): T {
  const normalized = cloneDeep(settings);
  if (Array.isArray(normalized.stop)) {
    normalized.stop = normalizeStopSequences(normalized.stop);
  }
  if (Array.isArray(normalized.prompts)) {
    normalized.prompts = normalized.prompts.map((prompt) => {
      const injectionPosition = prompt.injection_position as unknown;
      return {
        ...prompt,
        injection_position:
          injectionPosition === 0
            ? 'relative'
            : injectionPosition === 1
              ? 'in-chat'
              : injectionPosition,
      };
    }) as T['prompts'];
  }
  return normalized;
}
