import type { ApiModel, ApiProvider, ConnectionProfile } from '../../../types';
import type { ModelGroup, RandomizerProfile } from './types';

// TODO: i18n

/**
 * Get a random element from an array
 */
export function getRandomElement<T>(array: T[]): T | null {
  if (array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Get a random number within a range (inclusive)
 */
export function getRandomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Select a random connection profile from the given IDs
 */
export function selectRandomConnectionProfile(
  profileIds: string[],
  allProfiles: ConnectionProfile[],
): ConnectionProfile | null {
  if (profileIds.length === 0) return null;

  const availableProfiles = allProfiles.filter((p) => profileIds.includes(p.id));
  return getRandomElement(availableProfiles);
}

/**
 * Select a random model from model groups
 */
export function selectRandomModelFromGroups(
  groups: ModelGroup[],
): { model: { id: string; name: string }; group: ModelGroup } | null {
  if (groups.length === 0) return null;

  const group = getRandomElement(groups);
  if (!group || group.modelIds.length === 0) return null;

  const modelId = getRandomElement(group.modelIds);
  if (!modelId) return null;

  return {
    model: { id: modelId, name: modelId },
    group,
  };
}

/**
 * Get all models for a specific provider
 */
export function getModelsForProvider(provider: ApiProvider, modelList: ApiModel[]): ApiModel[] {
  return modelList.filter((m) => m.provider === provider || !m.provider);
}

/**
 * Validate if a profile is configured correctly
 */
export function validateProfile(
  profile: RandomizerProfile,
  allProfiles: ConnectionProfile[],
): { valid: boolean; error?: string } {
  if (!profile.enabled) {
    return { valid: false, error: 'Profile is disabled' };
  }

  if (profile.type === 'connection-profiles') {
    if (!profile.connectionProfileIds || profile.connectionProfileIds.length === 0) {
      return { valid: false, error: 'No connection profiles selected' };
    }

    const availableProfiles = allProfiles.filter((p) => profile.connectionProfileIds!.includes(p.id));
    if (availableProfiles.length === 0) {
      return { valid: false, error: 'No valid connection profiles found' };
    }

    return { valid: true };
  } else if (profile.type === 'model-groups') {
    if (!profile.modelGroups || profile.modelGroups.length === 0) {
      return { valid: false, error: 'No model groups configured' };
    }

    const hasValidGroup = profile.modelGroups.some((group) => group.modelIds.length > 0);
    if (!hasValidGroup) {
      return { valid: false, error: 'No model groups have models selected' };
    }

    return { valid: true };
  }

  return { valid: false, error: 'Invalid profile type' };
}
