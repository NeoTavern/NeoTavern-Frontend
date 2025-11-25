<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { useCharacterUiStore } from '../../stores/character-ui.store';
import { useCharacterStore } from '../../stores/character.store';
import { useSettingsStore } from '../../stores/settings.store';
import { getThumbnailUrl } from '../../utils/character';
import { EmptyState, MainContentFullscreenToggle, Pagination, SidebarHeader, SplitPane } from '../common';
import { Button, FileInput, ListItem, Search, Select } from '../UI';
import CharacterEditForm from './CharacterEditForm.vue';

const { t } = useStrictI18n();

const props = defineProps<{
  mode?: 'full' | 'main-only' | 'side-only';
}>();

const characterStore = useCharacterStore();
const characterUiStore = useCharacterUiStore();
const settingsStore = useSettingsStore();

const isSearchActive = ref(false);
const highlightedItemRef = ref<HTMLElement | null>(null);

const displayMode = computed(() => props.mode ?? 'full');
const isSideOnly = computed(() => displayMode.value === 'side-only');
const isMainOnly = computed(() => displayMode.value === 'main-only');

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
  <template v-if="isSideOnly">
    <div class="standalone-pane character-panel">
      <SidebarHeader :title="t('navbar.characterManagement')" />
      <div class="sidebar-controls character-panel-controls">
        <div class="sidebar-controls__row character-panel-actions">
          <Button variant="ghost" icon="fa-user-plus" :title="t('characterPanel.createNew')" @click="createNew" />
          <FileInput
            accept=".json,.png"
            multiple
            icon="fa-file-import"
            :label="t('characterPanel.importFile')"
            @change="handleFileImport"
          />
          <Button variant="ghost" icon="fa-cloud-arrow-down" :title="t('characterPanel.importUrl')" />

          <div id="extension-buttons-container"></div>

          <Button
            variant="ghost"
            icon="fa-search"
            :title="t('characterPanel.searchToggle')"
            @click="isSearchActive = !isSearchActive"
          />
        </div>

        <div v-show="isSearchActive" class="sidebar-controls__row character-panel-search-row">
          <Search v-model="characterUiStore.searchTerm" :placeholder="t('characterPanel.searchPlaceholder')">
            <template #actions>
              <div style="min-width: 140px">
                <Select
                  v-model="characterUiStore.sortOrder"
                  :options="sortOptions"
                  :title="t('characterPanel.sorting.title')"
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

      <div id="character-list" class="character-panel-character-list">
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
            :active="characterUiStore.editFormCharacter?.avatar === character.avatar"
            :class="{ 'flash animated': character.avatar === characterUiStore.highlightedAvatar }"
            :data-character-avatar="character.avatar"
            @click="characterUiStore.selectCharacterByAvatar(character.avatar)"
          >
            <template #start>
              <img :src="getThumbnailUrl('avatar', character.avatar)" :alt="`${character.name} Avatar`" />
            </template>

            <template #default>
              <div style="display: flex; align-items: center; gap: 4px">
                <span class="font-bold">{{ character.name }}</span>
                <i
                  v-if="character.fav"
                  class="fa-solid fa-star"
                  style="color: var(--color-golden); font-size: 0.8em"
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
    </div>
  </template>

  <template v-else-if="isMainOnly">
    <div class="standalone-pane character-panel">
      <div class="main-page-header">
        <div class="main-page-header-left">
          <MainContentFullscreenToggle />
        </div>
        <div class="main-page-header-main">
          <h3>{{ t('navbar.characterManagement') }}</h3>
        </div>
        <div class="main-page-header-actions"></div>
      </div>

      <div class="main-page-content">
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
      </div>
    </div>
  </template>

  <SplitPane
    v-else
    v-model:collapsed="settingsStore.settings.account.characterBrowserExpanded"
    storage-key="characterBrowserWidth"
    class="character-panel"
  >
    <template #side>
      <div class="sidebar-controls character-panel-controls">
        <div class="sidebar-controls__row character-panel-actions">
          <Button variant="ghost" icon="fa-user-plus" :title="t('characterPanel.createNew')" @click="createNew" />
          <FileInput
            accept=".json,.png"
            multiple
            icon="fa-file-import"
            :label="t('characterPanel.importFile')"
            @change="handleFileImport"
          />
          <Button variant="ghost" icon="fa-cloud-arrow-down" :title="t('characterPanel.importUrl')" />

          <div id="extension-buttons-container"></div>

          <Button
            variant="ghost"
            icon="fa-search"
            :title="t('characterPanel.searchToggle')"
            @click="isSearchActive = !isSearchActive"
          />
        </div>

        <div v-show="isSearchActive" class="sidebar-controls__row character-panel-search-row">
          <Search v-model="characterUiStore.searchTerm" :placeholder="t('characterPanel.searchPlaceholder')">
            <template #actions>
              <div style="min-width: 140px">
                <Select
                  v-model="characterUiStore.sortOrder"
                  :options="sortOptions"
                  :title="t('characterPanel.sorting.title')"
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

      <div id="character-list" class="character-panel-character-list">
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
            :active="characterUiStore.editFormCharacter?.avatar === character.avatar"
            :class="{ 'flash animated': character.avatar === characterUiStore.highlightedAvatar }"
            :data-character-avatar="character.avatar"
            @click="characterUiStore.selectCharacterByAvatar(character.avatar)"
          >
            <template #start>
              <img :src="getThumbnailUrl('avatar', character.avatar)" :alt="`${character.name} Avatar`" />
            </template>

            <template #default>
              <div style="display: flex; align-items: center; gap: 4px">
                <span class="font-bold">{{ character.name }}</span>
                <i
                  v-if="character.fav"
                  class="fa-solid fa-star"
                  style="color: var(--color-golden); font-size: 0.8em"
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
  </SplitPane>
</template>

<style scoped>
.font-bold {
  font-weight: bold;
}

.standalone-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--theme-background-tint);
  min-height: 0;
  min-width: 0;
}
</style>
