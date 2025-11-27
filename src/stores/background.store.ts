import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { deleteBackground, fetchAllBackgrounds, renameBackground, uploadBackground } from '../api/backgrounds';
import { useStrictI18n } from '../composables/useStrictI18n';
import { toast } from '../composables/useToast';
import type { BackgroundFitting } from '../types';
import { useChatStore } from './chat.store';
import { useSettingsStore } from './settings.store';

export const useBackgroundStore = defineStore('background', () => {
  const { t } = useStrictI18n();
  const settingsStore = useSettingsStore();
  const chatStore = useChatStore();

  const systemBackgrounds = ref<string[]>([]);
  const chatBackgrounds = ref<string[]>([]);
  const searchTerm = ref('');

  const thumbnailColumns = computed({
    get: () => settingsStore.settings.ui.background.thumbnailColumns,
    set: (value) => (settingsStore.settings.ui.background.thumbnailColumns = value),
  });

  const fitting = computed({
    get: () => settingsStore.settings.ui.background.fitting,
    set: (value) => (settingsStore.settings.ui.background.fitting = value),
  });

  const isLocked = computed(() => {
    return !!chatStore.activeChat?.metadata.custom_background;
  });

  const currentBackgroundUrl = computed(() => {
    const lockedBg = chatStore.activeChat?.metadata.custom_background;
    return lockedBg ?? settingsStore.settings.ui.background.url;
  });

  const filteredSystemBackgrounds = computed(() =>
    systemBackgrounds.value.filter((bg) => bg.toLowerCase().includes(searchTerm.value.toLowerCase())),
  );

  const filteredChatBackgrounds = computed(() =>
    chatBackgrounds.value.filter((bg) => bg.toLowerCase().includes(searchTerm.value.toLowerCase())),
  );

  async function initialize() {
    try {
      const { images } = await fetchAllBackgrounds();
      systemBackgrounds.value = images;
    } catch (error) {
      console.error('Failed to fetch backgrounds:', error);
      toast.error(t('backgrounds.errors.fetch'));
    }
  }

  function setBackground(fileName: string, fileUrl: string, fittingMode: BackgroundFitting) {
    settingsStore.settings.ui.background.name = fileName;
    settingsStore.settings.ui.background.url = fileUrl;
    settingsStore.settings.ui.background.fitting = fittingMode;
  }

  function selectBackground(fileName: string) {
    const fileUrl = `url("/backgrounds/${encodeURIComponent(fileName)}")`;

    if (isLocked.value) {
      lockBackground(fileUrl);
    } else {
      settingsStore.settings.ui.background.name = fileName;
      settingsStore.settings.ui.background.url = fileUrl;
    }
  }

  function lockBackground(url: string) {
    if (!chatStore.activeChat) {
      toast.warning(t('backgrounds.errors.noChatLock'));
      return;
    }

    chatStore.activeChat.metadata.custom_background = url;
    chatStore.triggerSave();
  }

  function toggleLock() {
    if (!chatStore.activeChat) {
      toast.warning(t('backgrounds.errors.noChatLock'));
      return;
    }

    if (isLocked.value) {
      delete chatStore.activeChat!.metadata.custom_background;
    } else {
      chatStore.activeChat.metadata.custom_background = settingsStore.settings.ui.background.url;
    }
    chatStore.triggerSave();
  }

  async function handleUpload(file: File) {
    // TODO: Video conversion logic
    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const newBg = await uploadBackground(formData);
      await initialize();
      selectBackground(newBg);
      // TODO: Highlight new background
    } catch (error) {
      console.error('Error uploading background:', error);
      toast.error(t('backgrounds.errors.upload'));
    }
  }

  async function handleDelete(fileName: string, isCustom: boolean) {
    try {
      if (isCustom) {
        // TODO: Implement custom background deletion from chat metadata
      } else {
        await deleteBackground(fileName);
      }
      await initialize();
    } catch (error) {
      console.error(`Failed to delete background ${fileName}:`, error);
      toast.error(t('backgrounds.errors.delete'));
    }
  }

  async function handleRename(oldName: string, newName: string) {
    try {
      await renameBackground(oldName, newName);
      await initialize();
    } catch (error) {
      console.error(`Failed to rename background ${oldName}:`, error);
      toast.error(t('backgrounds.errors.rename'));
    }
  }

  return {
    systemBackgrounds,
    chatBackgrounds,
    searchTerm,
    thumbnailColumns,
    fitting,
    isLocked,
    currentBackgroundUrl,
    filteredSystemBackgrounds,
    filteredChatBackgrounds,
    initialize,
    setBackground,
    selectBackground,
    lockBackground,
    toggleLock,
    handleUpload,
    handleDelete,
    handleRename,
  };
});
