<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useBackgroundStore } from '../../stores/background.store';
import { useChatStore } from '../../stores/chat.store';
import { usePopupStore } from '../../stores/popup.store';
import { getThumbnailUrl } from '../../utils/image';
import { POPUP_RESULT, POPUP_TYPE } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';

const { t } = useStrictI18n();
const backgroundStore = useBackgroundStore();
const chatStore = useChatStore();
const popupStore = usePopupStore();

const fileInput = ref<HTMLInputElement | null>(null);
const scrollableContent = ref<HTMLElement | null>(null);
const isScrolled = ref(false);

const THUMBNAIL_COLUMNS_MIN = 2;
const THUMBNAIL_COLUMNS_MAX = 8;

const lockedBackgroundUrl = computed(() => chatStore.chatMetadata.custom_background);

function triggerFileUpload() {
  fileInput.value?.click();
}

async function handleFileSelected(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.files?.[0]) {
    await backgroundStore.handleUpload(target.files[0]);
  }
  target.value = ''; // Reset for next upload
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

onMounted(() => {
  backgroundStore.initialize();
  scrollableContent.value?.addEventListener('scroll', handleScroll);
});
</script>

<template>
  <div class="backgrounds-drawer">
    <div class="backgrounds-drawer-header">
      <div class="backgrounds-drawer-header-row">
        <label class="menu-button" @click="triggerFileUpload">
          <i class="fa-solid fa-plus"></i>
          <span>{{ t('backgrounds.add') }}</span>
        </label>
        <input ref="fileInput" type="file" accept="image/*" hidden @change="handleFileSelected" />
        <span class="expander"></span>
        <select v-model="backgroundStore.fitting" class="text-pole" :title="t('backgrounds.fitting')">
          <option value="classic">{{ t('backgrounds.fittingOptions.classic') }}</option>
          <option value="cover">{{ t('backgrounds.fittingOptions.cover') }}</option>
          <option value="contain">{{ t('backgrounds.fittingOptions.contain') }}</option>
          <option value="stretch">{{ t('backgrounds.fittingOptions.stretch') }}</option>
          <option value="center">{{ t('backgrounds.fittingOptions.center') }}</option>
        </select>
        <div class="menu-button" :title="t('backgrounds.autoSelectTooltip')">
          <i class="fa-solid fa-wand-magic"></i>
          <span>{{ t('backgrounds.autoSelect') }}</span>
        </div>
      </div>
      <div class="backgrounds-drawer-header-row">
        <input
          v-model="backgroundStore.searchTerm"
          class="text-pole"
          type="search"
          :placeholder="t('backgrounds.searchPlaceholder')"
        />
      </div>
    </div>

    <div ref="scrollableContent" class="backgrounds-drawer-scrollable-content">
      <div class="heading-container">
        <h3>{{ t('backgrounds.systemBackgrounds') }}</h3>
        <div class="heading-controls">
          <button
            class="menu-button"
            :title="t('backgrounds.zoomIn')"
            :disabled="backgroundStore.thumbnailColumns <= THUMBNAIL_COLUMNS_MIN"
            @click="zoomIn"
          >
            <i class="fa-solid fa-minus"></i>
          </button>
          <button
            class="menu-button"
            :title="t('backgrounds.zoomOut')"
            :disabled="backgroundStore.thumbnailColumns >= THUMBNAIL_COLUMNS_MAX"
            @click="zoomOut"
          >
            <i class="fa-solid fa-plus"></i>
          </button>
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
            'is-locked': lockedBackgroundUrl === `url(&quot;/backgrounds/${encodeURIComponent(bg)}&quot;)`,
          }"
          :title="bg"
          @click="backgroundStore.selectBackground(bg)"
        >
          <div class="background-item-thumbnail" :style="{ backgroundImage: `url(${getThumbnailUrl('bg', bg)})` }">
            <div class="background-item-title">{{ getBgFileName(bg) }}</div>
          </div>
          <div class="background-item-menu">
            <div
              class="menu-button fa-solid fa-lock"
              :title="t('backgrounds.actions.lock')"
              @click.stop="backgroundStore.lockBackground(`url(&quot;/backgrounds/${encodeURIComponent(bg)}&quot;)`)"
            ></div>
            <div
              class="menu-button fa-solid fa-lock-open"
              :title="t('backgrounds.actions.unlock')"
              @click.stop="backgroundStore.unlockBackground()"
            ></div>
            <div
              class="menu-button fa-solid fa-pen-to-square"
              :title="t('backgrounds.actions.rename')"
              @click.stop="handleRename(bg)"
            ></div>
            <div
              class="menu-button fa-solid fa-trash-can"
              :title="t('backgrounds.actions.delete')"
              @click.stop="handleDelete(bg, false)"
            ></div>
          </div>
        </div>
      </div>

      <!-- TODO: Implement Chat Backgrounds -->
    </div>

    <button class="backgrounds-drawer-scroll-top" :class="{ visible: isScrolled }" @click="scrollToTop">
      <i class="fa-solid fa-chevron-up"></i>
    </button>
  </div>
</template>
