import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { MenuType } from '../types';

export const useUiStore = defineStore('ui', () => {
  const isChatSaving = ref<boolean>(false);
  const isDeleteMode = ref<boolean>(false);
  const isSendPress = ref<boolean>(false);
  const selectedButton = ref<MenuType | null>(null);
  const menuType = ref<MenuType | null>(null);
  const cropData = ref<any>(null);
  const activePlayerName = ref<string | null>(null);

  return {
    isChatSaving,
    isDeleteMode,
    isSendPress,
    selectedButton,
    menuType,
    cropData,
    activePlayerName,
  };
});
