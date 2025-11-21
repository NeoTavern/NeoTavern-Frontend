<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useCharacterStore } from '../../stores/character.store';
import CharacterEditForm from './CharacterEditForm.vue';
import Pagination from '../Common/Pagination.vue';
import { getThumbnailUrl } from '../../utils/image';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useSettingsStore } from '../../stores/settings.store';
import { AppIconButton, AppInput, AppSelect, AppButton } from '../UI';
import SplitPane from '../Common/SplitPane.vue';
import EmptyState from '../Common/EmptyState.vue';

const { t } = useStrictI18n();

const characterStore = useCharacterStore();
const settingsStore = useSettingsStore();

const isSearchActive = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const characterListEl = ref<HTMLElement | null>(null);
const highlightedItemRef = ref<HTMLElement | null>(null);

// Watch for a character being highlighted by the store
watch(
  () => characterStore.highlightedAvatar,
  (avatar) => {
    if (avatar && highlightedItemRef.value) {
      highlightedItemRef.value.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },
  { flush: 'post' }, // Wait for the DOM to update
);

function createNew() {
  characterStore.startCreating();
}

function triggerImport() {
  fileInput.value?.click();
}

async function handleFileImport(event: Event) {
  const target = event.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;

  const files = Array.from(target.files);
  const importedAvatars: string[] = [];

  for (const file of files) {
    try {
      const avatarFileName = await characterStore.importCharacter(file);
      if (avatarFileName) {
        importedAvatars.push(avatarFileName);
      }
    } catch {
      // Toast is handled in the store action
    }
  }

  if (importedAvatars.length > 0) {
    await characterStore.refreshCharacters();
    await characterStore.importTagsForCharacters(importedAvatars);
    const lastAvatar = importedAvatars[importedAvatars.length - 1];
    characterStore.highlightCharacter(lastAvatar);
  }

  if (target) {
    target.value = '';
  }
}

const sortOptions = [
  { value: 'name:asc', label: t('characterPanel.sorting.nameAsc') },
  { value: 'name:desc', label: t('characterPanel.sorting.nameDesc') },
  { value: 'create_date:desc', label: t('characterPanel.sorting.newest') },
  { value: 'create_date:asc', label: t('characterPanel.sorting.oldest') },
  { value: 'fav:desc', label: t('characterPanel.sorting.favorites') },
];

onMounted(() => {
  characterStore.refreshCharacters();
});
</script>

<template>
  <SplitPane
    v-model:collapsed="settingsStore.settings.account.characterBrowserExpanded"
    storage-key="characterBrowserWidth"
    class="character-panel"
  >
    <template #side>
      <div class="character-panel-browser-header">
        <div class="character-panel-actions">
          <AppIconButton icon="fa-user-plus" :title="t('characterPanel.createNew')" @click="createNew" />
          <AppIconButton icon="fa-file-import" :title="t('characterPanel.importFile')" @click="triggerImport" />

          <input ref="fileInput" type="file" accept=".json,.png" multiple hidden @change="handleFileImport" />

          <AppIconButton icon="fa-cloud-arrow-down" :title="t('characterPanel.importUrl')" />
          <AppIconButton icon="fa-users-gear" :title="t('characterPanel.createGroup')" />

          <div id="extension-buttons-container"></div>

          <AppIconButton
            icon="fa-search"
            :title="t('characterPanel.searchToggle')"
            @click="isSearchActive = !isSearchActive"
          />
        </div>

        <div v-show="isSearchActive" id="character-search-form" class="character-panel-search-form">
          <div style="flex-grow: 1">
            <AppInput
              v-model="characterStore.searchTerm"
              type="search"
              :placeholder="t('characterPanel.searchPlaceholder')"
            />
          </div>
          <div style="min-width: 140px">
            <AppSelect
              v-model="characterStore.sortOrder"
              :options="sortOptions"
              :title="t('characterPanel.sorting.title')"
            />
          </div>
        </div>
      </div>

      <div class="character-panel-pagination">
        <Pagination
          v-if="characterStore.displayableCharacters.length > 0"
          v-model:current-page="characterStore.currentPage"
          v-model:items-per-page="characterStore.itemsPerPage"
          :total-items="characterStore.displayableCharacters.length"
          :items-per-page-options="[10, 25, 50, 100]"
        />
      </div>

      <div id="character-list" ref="characterListEl" class="character-panel-character-list">
        <div v-if="characterStore.paginatedCharacters.length === 0" style="padding: 10px; opacity: 0.7">
          {{ t('common.loading') }}
        </div>
        <template v-for="character in characterStore.paginatedCharacters" :key="character.id">
          <div
            :ref="
              (el) => {
                if (character.avatar === characterStore.highlightedAvatar) {
                  highlightedItemRef = el as HTMLElement;
                }
              }
            "
            class="character-item"
            :class="{
              'is-active': characterStore.editFormCharacter?.avatar === character.avatar,
              'flash animated': character.avatar === characterStore.highlightedAvatar,
            }"
            tabindex="0"
            :data-character-avatar="character.avatar"
            @click="characterStore.selectCharacterByAvatar(character.avatar)"
          >
            <div class="character-item-avatar">
              <img :src="getThumbnailUrl('avatar', character.avatar)" :alt="`${character.name} Avatar`" />
            </div>
            <div class="character-item-content">
              <div class="character-item-header">
                <span class="character-item-name">{{ character.name }}</span>
                <i v-if="character.fav" class="character-item-fav-icon fa-solid fa-star"></i>
              </div>
              <div class="character-item-description">{{ character.description || '&nbsp;' }}</div>
            </div>
          </div>
        </template>
      </div>
    </template>

    <template #main>
      <div class="character-panel-editor">
        <EmptyState
          v-show="!characterStore.editFormCharacter"
          icon="fa-user-pen"
          :title="t('characterPanel.editor.placeholderTitle')"
          :description="t('characterPanel.editor.placeholderText')"
        >
          <AppButton icon="fa-user-plus" @click="createNew">
            {{ t('characterPanel.editor.placeholderButton') }}
          </AppButton>
        </EmptyState>

        <CharacterEditForm v-show="characterStore.editFormCharacter" />
      </div>
    </template>
  </SplitPane>
</template>
