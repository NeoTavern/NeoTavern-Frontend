import { atom } from 'nanostores';
import type { Character } from '../types';

export const characters = atom<Array<Character>>([]);
export const activeCharacterIndex = atom<number | null>(null);
export const activeCharacterName = atom<string | null>(null);
export const favoriteCharacterChecked = atom<boolean>(false);
