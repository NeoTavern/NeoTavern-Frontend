import type { ApiProvider } from '../../../types';

export interface ModelGroup {
  id: string;
  name: string;
  provider: ApiProvider;
  modelIds: string[];
  temperatureRange?: {
    min: number;
    max: number;
  };
}

export interface RandomizerProfile {
  id: string;
  name: string;
  type: 'connection-profiles' | 'model-groups';
  connectionProfileIds?: string[];
  modelGroups?: ModelGroup[];
  enabled: boolean;
}

export interface RandomizerSettings {
  enabled: boolean;
  profiles: RandomizerProfile[];
  activeProfileId: string;
}

export const EXTENSION_KEY = 'core.model-randomizer';

export const DEFAULT_SETTINGS: RandomizerSettings = {
  enabled: true,
  profiles: [],
  activeProfileId: '',
};
