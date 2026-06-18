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
  return normalized;
}
