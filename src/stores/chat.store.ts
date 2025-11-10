import { atom } from 'nanostores';
import type { ChatMessage } from '../types';

export const chat = atom<Array<ChatMessage>>([]);
export const chatMetadata = atom<Record<string, any>>({});
export const chatCreateDate = atom<string | null>(null);
export const activeMessageEditIndex = atom<number | null>(null);
export const chatSaveTimeout = atom<ReturnType<typeof setTimeout> | null>(null);
export const saveMetadataTimeout = atom<ReturnType<typeof setTimeout> | null>(null);
