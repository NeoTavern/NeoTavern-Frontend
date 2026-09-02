import type { ExtensionAPI } from '../../../../types';
import type { GraphSettingsAPI } from '../settings/store';

export type CustomAgentsHostAPI = Omit<ExtensionAPI, 'settings'> & GraphSettingsAPI;
