import { atom } from 'nanostores';
import type { Group } from '../types';

export const groups = atom<Array<Group>>([]);
export const activeGroupId = atom<string | null>(null);
export const isGroupGenerating = atom<boolean>(false);
