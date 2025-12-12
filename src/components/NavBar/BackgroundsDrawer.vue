<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useBackgroundStore } from '../../stores/background.store';
import { useChatStore } from '../../stores/chat.store';
import { usePopupStore } from '../../stores/popup.store';
import { POPUP_RESULT, POPUP_TYPE, type BackgroundFitting } from '../../types';
import { getThumbnailUrl } from '../../utils/character';
import { Button, FileInput, Search, Select } from '../UI';

const { t } = useStrictI18n();
const backgroundStore = useBackgroundStore();
const chatStore = useChatStore();
const popupStore = usePopupStore();

const scrollableContent = ref<HTMLElement | null>(null);
const isScrolled = ref(false);

const THUMBNAIL_COLUMNS_MIN = 2;
const THUMBNAIL_COLUMNS_MAX = 8;

const hasActiveChat = computed(() => !!chatStore.activeChatFile);

async function handleFileSelected(files: File[]) {
  if (files[0]) {
    await backgroundStore.handleUpload(files[0]);
  }
}

function zoomIn() {
  if (backgroundStore.thumbnailColumns > THUMBNAIL_COLUMNS_MIN) {
    backgroundStore.thumbnailColumns--;
  }
}

function zoomOut() {
  if (backgroundStore.thumbnailColumns < THUMBNAIL_COLUMNS_MAX) {
    backgroundStore.thumbnailColumns++;
  }
}

async function handleDelete(fileName: string, isCustom: boolean) {
  const { result } = await popupStore.show({
    title: t('common.confirm'),
    content: t('backgrounds.confirmDelete', { fileName }),
    type: POPUP_TYPE.CONFIRM,
  });
  if (result === POPUP_RESULT.AFFIRMATIVE) {
    backgroundStore.handleDelete(fileName, isCustom);
  }
}

async function handleRename(fileName: string) {
  const fileExtension = fileName.split('.').pop();
  const baseName = fileName.replace(`.${fileExtension}`, '');

  const { result, value } = await popupStore.show({
    title: t('backgrounds.renameTitle'),
    type: POPUP_TYPE.INPUT,
    inputValue: baseName,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && value) {
    const newName = `${value}.${fileExtension}`;
    backgroundStore.handleRename(fileName, newName);
  }
}

function getBgFileName(fullName: string) {
  return fullName.substring(0, fullName.lastIndexOf('.'));
}

function scrollToTop() {
  scrollableContent.value?.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleScroll() {
  isScrolled.value = (scrollableContent.value?.scrollTop ?? 0) > 200;
}

watch(
  () => backgroundStore.thumbnailColumns,
  (newVal) => {
    document.documentElement.style.setProperty('--bg-thumb-columns', String(newVal));
  },
  { immediate: true },
);

const fittingOptions = computed<{ label: string; value: BackgroundFitting }[]>(() => [
  { label: t('backgrounds.fittingOptions.classic'), value: 'classic' },
  { label: t('backgrounds.fittingOptions.cover'), value: 'cover' },
  { label: t('backgrounds.fittingOptions.contain'), value: 'contain' },
  { label: t('backgrounds.fittingOptions.stretch'), value: 'stretch' },
  { label: t('backgrounds.fittingOptions.center'), value: 'center' },
]);

onMounted(() => {
  scrollableContent.value?.addEventListener('scroll', handleScroll);
});
</script>

<template>
  <div class="backgrounds-drawer">
    <div class="backgrounds-drawer-header">
      <div class="backgrounds-drawer-header-row">
        <FileInput
          accept="image/*"
          type="button"
          icon="fa-plus"
          :label="t('backgrounds.add')"
          @change="handleFileSelected"
        />
        <span class="expander"></span>

        <!-- Global Lock/Unlock Toggle -->
        <Button
          v-if="hasActiveChat"
          :variant="backgroundStore.isLocked ? 'confirm' : 'ghost'"
          :icon="backgroundStore.isLocked ? 'fa-lock' : 'fa-lock-open'"
          :title="backgroundStore.isLocked ? t('backgrounds.actions.unlock') : t('backgrounds.actions.lock')"
          @click="backgroundStore.toggleLock"
        />

        <div style="width: 120px">
          <Select v-model="backgroundStore.fitting" :options="fittingOptions" :title="t('backgrounds.fitting')" />
        </div>
        <Button icon="fa-wand-magic" :title="t('backgrounds.autoSelectTooltip')">
          {{ t('backgrounds.autoSelect') }}
        </Button>
      </div>
      <div class="backgrounds-drawer-header-row">
        <Search v-model="backgroundStore.searchTerm" :placeholder="t('backgrounds.searchPlaceholder')" />
      </div>
    </div>

    <div ref="scrollableContent" class="backgrounds-drawer-scrollable-content">
      <div class="heading-container">
        <h3>{{ t('backgrounds.systemBackgrounds') }}</h3>
        <div class="heading-controls">
          <Button
            variant="ghost"
            icon="fa-minus"
            :title="t('backgrounds.zoomIn')"
            :disabled="backgroundStore.thumbnailColumns <= THUMBNAIL_COLUMNS_MIN"
            @click="zoomIn"
          />
          <Button
            variant="ghost"
            icon="fa-plus"
            :title="t('backgrounds.zoomOut')"
            :disabled="backgroundStore.thumbnailColumns >= THUMBNAIL_COLUMNS_MAX"
            @click="zoomOut"
          />
        </div>
      </div>
      <div class="backgrounds-drawer-grid">
        <div
          v-for="bg in backgroundStore.filteredSystemBackgrounds"
          :key="bg"
          class="background-item"
          :class="{
            'is-selected':
              backgroundStore.currentBackgroundUrl === `url(&quot;/backgrounds/${encodeURIComponent(bg)}&quot;)`,
            'is-locked':
              backgroundStore.isLocked &&
              backgroundStore.currentBackgroundUrl === `url(&quot;/backgrounds/${encodeURIComponent(bg)}&quot;)`,
          }"
          :title="bg"
          @click="backgroundStore.selectBackground(bg)"
        >
          <div class="background-item-thumbnail" :style="{ backgroundImage: `url(${getThumbnailUrl('bg', bg)})` }">
            <div class="background-item-title">{{ getBgFileName(bg) }}</div>
          </div>
          <div class="background-item-menu">
            <Button
              variant="ghost"
              icon="fa-pen-to-square"
              :title="t('backgrounds.actions.rename')"
              @click.stop="handleRename(bg)"
            />
            <Button
              variant="danger"
              icon="fa-trash-can"
              :title="t('backgrounds.actions.delete')"
              @click.stop="handleDelete(bg, false)"
            />
          </div>
        </div>
      </div>
    </div>

    <button class="backgrounds-drawer-scroll-top" :class="{ visible: isScrolled }" @click="scrollToTop">
      <i class="fa-solid fa-chevron-up"></i>
    </button>
  </div>
</template>
