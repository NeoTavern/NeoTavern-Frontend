import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useSettingsStore } from './settings.store';
import { useChatStore } from './chat.store';
import { fetchAllBackgrounds, uploadBackground, deleteBackground, renameBackground } from '../api/backgrounds';
import { toast } from '../composables/useToast';
import type { BackgroundFitting } from '../types';
import i18n from '../i18n';

const BG_METADATA_KEY = 'custom_background';
const LIST_METADATA_KEY = 'chat_backgrounds';

export const useBackgroundStore = defineStore('background', () => {
  const { t } = i18n.global;
  const settingsStore = useSettingsStore();
  const chatStore = useChatStore();

  const systemBackgrounds = ref<string[]>([]);
  const chatBackgrounds = ref<string[]>([]);
  const searchTerm = ref('');

  const thumbnailColumns = computed({
    get: () => settingsStore.settings.background.thumbnailColumns,
    set: (value) => settingsStore.setSetting('background.thumbnailColumns', value),
  });

  const fitting = computed({
    get: () => settingsStore.settings.background.fitting,
    set: (value) => settingsStore.setSetting('background.fitting', value),
  });

  const currentBackgroundUrl = computed(() => {
    const lockedBg = chatStore.chatMetadata[BG_METADATA_KEY];
    return lockedBg ?? settingsStore.settings.background.url;
  });

  const filteredSystemBackgrounds = computed(() =>
    systemBackgrounds.value.filter((bg) => bg.toLowerCase().includes(searchTerm.value.toLowerCase())),
  );

  const filteredChatBackgrounds = computed(() =>
    chatBackgrounds.value.filter((bg) => bg.toLowerCase().includes(searchTerm.value.toLowerCase())),
  );

  watch(
    () => chatStore.chat,
    () => {
      chatBackgrounds.value = chatStore.chatMetadata[LIST_METADATA_KEY] ?? [];
    },
    { deep: true, immediate: true },
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
    settingsStore.setSetting('background.name', fileName);
    settingsStore.setSetting('background.url', fileUrl);
    settingsStore.setSetting('background.fitting', fittingMode);
  }

  function selectBackground(fileName: string, isCustom: boolean) {
    const fileUrl = `url("/backgrounds/${encodeURIComponent(fileName)}")`;
    if (chatStore.chatMetadata[BG_METADATA_KEY]) {
      // If locked, clicking a new background updates the lock
      lockBackground(fileUrl);
    } else {
      settingsStore.setSetting('background.name', fileName);
      settingsStore.setSetting('background.url', fileUrl);
    }
  }

  function lockBackground(url: string) {
    if (!chatStore.getCurrentChatId()) {
      toast.warning(t('backgrounds.errors.noChatLock'));
      return;
    }
    chatStore.chatMetadata[BG_METADATA_KEY] = url;
    chatStore.saveChat();
  }

  function unlockBackground() {
    delete chatStore.chatMetadata[BG_METADATA_KEY];
    chatStore.saveChat();
  }

  async function handleUpload(file: File) {
    // TODO: Video conversion logic
    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const newBg = await uploadBackground(formData);
      await initialize();
      selectBackground(newBg, false);
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
        toast.success(t('backgrounds.deleteSuccess', { fileName }));
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
      toast.success(t('backgrounds.renameSuccess', { oldName, newName }));
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
    currentBackgroundUrl,
    filteredSystemBackgrounds,
    filteredChatBackgrounds,
    initialize,
    setBackground,
    selectBackground,
    lockBackground,
    unlockBackground,
    handleUpload,
    handleDelete,
    handleRename,
  };
});
