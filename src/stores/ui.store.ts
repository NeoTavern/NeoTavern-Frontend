import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CropData, ZoomedAvatar } from '../types';

export const useUiStore = defineStore('ui', () => {
  const isChatSaving = ref(false);
  const isDeleteMode = ref(false);
  const isSendPress = ref(false);
  const cropData = ref<CropData | null>(null);
  const activePlayerName = ref<string | null>(null);
  const activePlayerAvatar = ref<string | null>(null);
  const zoomedAvatars = ref<ZoomedAvatar[]>([]);

  function toggleZoomedAvatar(avatarData: Omit<ZoomedAvatar, 'id'>) {
    const id = avatarData.charName;
    const existingIndex = zoomedAvatars.value.findIndex((avatar) => avatar.id === id);

    if (existingIndex > -1) {
      zoomedAvatars.value.splice(existingIndex, 1);
    } else {
      zoomedAvatars.value.push({ ...avatarData, id });
    }
  }

  function removeZoomedAvatar(id: string) {
    const index = zoomedAvatars.value.findIndex((avatar) => avatar.id === id);
    if (index > -1) zoomedAvatars.value.splice(index, 1);
  }

  return {
    isChatSaving,
    isDeleteMode,
    isSendPress,
    cropData,
    activePlayerName,
    activePlayerAvatar,
    zoomedAvatars,
    toggleZoomedAvatar,
    removeZoomedAvatar,
  };
});
