import { atom } from 'nanostores';
import type { MenuType } from '../types';

export const isChatSaving = atom<boolean>(false);
export const isDeleteMode = atom<boolean>(false);
export const isSendPress = atom<boolean>(false);
export const selectedButton = atom<MenuType | null>(null);
export const menuType = atom<MenuType | null>(null);
export const cropData = atom<any>(null);
export const activePlayerName = atom<string>('User');
