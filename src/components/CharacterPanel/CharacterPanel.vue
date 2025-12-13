<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { useCharacterUiStore } from '../../stores/character-ui.store';
import { useCharacterStore } from '../../stores/character.store';
import { useLayoutStore } from '../../stores/layout.store';
import { useSettingsStore } from '../../stores/settings.store';
import type { Character } from '../../types';
import { getThumbnailUrl } from '../../utils/character';
import { EmptyState, Pagination, PanelLayout } from '../common';
import { Button, FileInput, ListItem, Search, Select } from '../UI';
import CharacterEditForm from './CharacterEditForm.vue';

const { t } = useStrictI18n();

const props = defineProps<{
  mode?: 'full' | 'main-only' | 'side-only';
  title?: string;
}>();

const characterStore = useCharacterStore();
const characterUiStore = useCharacterUiStore();
const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();

const isSearchActive = ref(false);
const highlightedItemRef = ref<HTMLElement | null>(null);

watch(
  () => characterUiStore.highlightedAvatar,
  (avatar) => {
    if (avatar && highlightedItemRef.value) {
      highlightedItemRef.value.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },
  { flush: 'post' },
);

function createNew() {
  characterUiStore.startCreating();
  layoutStore.autoCloseSidebarsOnMobile();
}

function handleCharacterSelect(character: Character) {
  characterUiStore.selectCharacterByAvatar(character.avatar);
  layoutStore.autoCloseSidebarsOnMobile();
}

async function handleFileImport(files: File[]) {
  const importedAvatars: string[] = [];

  for (const file of files) {
    try {
      const avatarFileName = await characterStore.importCharacter(file);
      if (avatarFileName) {
        importedAvatars.push(avatarFileName);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.message?.startsWith('unsupported_type')) {
        toast.warning(t('character.import.unsupportedType', { ext: file.name.split('.').pop() }));
      } else {
        toast.error(t('character.import.error'), t('character.import.errorMessage'));
      }
    }
  }

  if (importedAvatars.length > 0) {
    const importResults = await characterStore.importTagsForCharacters(importedAvatars);

    for (const [avatar, tags] of Object.entries(importResults)) {
      const char = characterStore.characters.find((c) => c.avatar === avatar);
      if (char && tags.length > 0) {
        toast.success(
          t('character.import.tagsImportedMessage', { characterName: char.name, tags: tags.join(', ') }),
          t('character.import.tagsImported'),
          { timeout: 6000 },
        );
      }
    }

    const lastAvatar = importedAvatars[importedAvatars.length - 1];
    characterUiStore.highlightCharacter(lastAvatar);
  }
}

const sortOptions = [
  { value: 'name:asc', label: t('characterPanel.sorting.nameAsc') },
  { value: 'name:desc', label: t('characterPanel.sorting.nameDesc') },
  { value: 'create_date:desc', label: t('characterPanel.sorting.newest') },
  { value: 'create_date:asc', label: t('characterPanel.sorting.oldest') },
  { value: 'fav:desc', label: t('characterPanel.sorting.favorites') },
];

function handleClose() {
  layoutStore.activateNavBarItem('chat');
  layoutStore.autoCloseSidebarsOnMobile();
}

onMounted(async () => {
  if (characterStore.characters.length === 0) {
    try {
      await characterStore.refreshCharacters();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (e.message === 'overflow') {
        toast.warning(t('character.fetch.overflowWarning'));
      }
    }
  }
});
</script>

<template>
  <PanelLayout
    :mode="props.mode"
    :title="props.title ?? t('navbar.characterManagement')"
    :collapsed="settingsStore.settings.account.characterBrowserExpanded"
    storage-key="characterBrowserWidth"
    class="character-panel"
    @update:collapsed="(val) => (settingsStore.settings.account.characterBrowserExpanded = val)"
  >
    <template #main-header-actions>
      <div class="sidebar-mobile-header">
        <Button icon="fa-xmark" variant="ghost" :title="t('common.close')" @click="handleClose" />
      </div>
    </template>
    <template #side>
      <div class="sidebar-controls character-panel-controls" role="toolbar" :aria-label="t('characterPanel.toolbar')">
        <div class="sidebar-controls-row character-panel-actions">
          <Button variant="ghost" icon="fa-user-plus" :title="t('characterPanel.createNew')" @click="createNew" />
          <FileInput
            accept=".json,.png"
            multiple
            icon="fa-file-import"
            :label="t('characterPanel.importFile')"
            @change="handleFileImport"
          />

          <div id="extension-buttons-container"></div>

          <Button
            variant="ghost"
            icon="fa-search"
            :title="t('characterPanel.searchToggle')"
            :active="isSearchActive"
            :aria-pressed="isSearchActive"
            @click="isSearchActive = !isSearchActive"
          />
        </div>

        <div v-show="isSearchActive" class="sidebar-controls-row character-panel-search-row">
          <Search v-model="characterUiStore.searchTerm" :placeholder="t('characterPanel.searchPlaceholder')">
            <template #actions>
              <div style="min-width: 140px">
                <Select
                  v-model="characterUiStore.sortOrder"
                  :options="sortOptions"
                  :title="t('characterPanel.sorting.title')"
                  :label="t('characterPanel.sorting.title')"
                />
              </div>
            </template>
          </Search>
        </div>
      </div>
      <div class="character-panel-pagination">
        <Pagination
          v-if="characterUiStore.displayableCharacters.length > 0"
          v-model:current-page="characterUiStore.currentPage"
          v-model:items-per-page="characterUiStore.itemsPerPage"
          :total-items="characterUiStore.displayableCharacters.length"
          :items-per-page-options="[10, 25, 50, 100]"
        />
      </div>

      <div
        id="character-list"
        class="character-panel-character-list"
        role="list"
        :aria-label="t('characterPanel.listLabel')"
      >
        <div v-if="characterUiStore.paginatedCharacters.length === 0" style="padding: 10px; opacity: 0.7">
          {{ t('common.loading') }}
        </div>
        <template v-for="character in characterUiStore.paginatedCharacters" :key="character.avatar">
          <ListItem
            :ref="
              (el: any) => {
                if (character.avatar === characterUiStore.highlightedAvatar) highlightedItemRef = el?.$el;
              }
            "
            role="listitem"
            :active="characterUiStore.editFormCharacter?.avatar === character.avatar"
            :class="{ 'flash animated': character.avatar === characterUiStore.highlightedAvatar }"
            :data-character-avatar="character.avatar"
            :aria-label="character.name"
            @click="handleCharacterSelect(character)"
          >
            <template #start>
              <img :src="getThumbnailUrl('avatar', character.avatar)" :alt="''" />
            </template>

            <template #default>
              <div style="display: flex; align-items: center; gap: 4px">
                <span class="font-bold">{{ character.name }}</span>
                <i
                  v-if="character.fav"
                  class="fa-solid fa-star"
                  style="color: var(--color-golden); font-size: 0.8em"
                  :aria-label="t('characterPanel.isFavorite')"
                ></i>
              </div>
              <div
                style="font-size: 0.8em; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
              >
                {{ character.description || '&nbsp;' }}
              </div>
            </template>
          </ListItem>
        </template>
      </div>
    </template>

    <template #main>
      <div class="character-panel-editor">
        <EmptyState
          v-show="!characterUiStore.editFormCharacter"
          icon="fa-user-pen"
          :title="t('characterPanel.editor.placeholderTitle')"
          :description="t('characterPanel.editor.placeholderText')"
        >
          <Button icon="fa-user-plus" @click="createNew">
            {{ t('characterPanel.editor.placeholderButton') }}
          </Button>
        </EmptyState>

        <CharacterEditForm v-show="characterUiStore.editFormCharacter" />
      </div>
    </template>
  </PanelLayout>
</template>
