<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useCharacterStore } from '../../stores/character.store';
import { useUiStore } from '../../stores/ui.store';
import { useApiStore } from '../../stores/api.store';
import type { Character, Group } from '../../types';
import CharacterEditForm from './CharacterEditForm.vue';
import Pagination from '../common/Pagination.vue';
import { getThumbnailUrl } from '../../utils/image';
import { useStrictI18n } from '../../composables/useStrictI18n';

const { t } = useStrictI18n();

const characterStore = useCharacterStore();
const uiStore = useUiStore();
const apiStore = useApiStore();
const isSearchActive = ref(false);
const isPanelPinned = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const showCharacterList = computed(() => {
  return uiStore.menuType !== 'character_edit' && uiStore.menuType !== 'create';
});

const totalTokens = computed(() => characterStore.totalTokens);
const permanentTokens = computed(() => characterStore.permanentTokens);
const activeCharacterName = computed(() => characterStore.activeCharacter?.name);

const maxContext = computed(() => apiStore.oaiSettings.openai_max_context ?? 4096);
const showTokenWarning = computed(() => {
  const tokenLimit = Math.max(maxContext.value / 2, 1024);
  return totalTokens.value > tokenLimit;
});

function triggerImport() {
  fileInput.value?.click();
}

async function handleFileImport(event: Event) {
  const target = event.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) {
    return;
  }

  const files = Array.from(target.files);
  const importedAvatars: string[] = [];

  for (const file of files) {
    try {
      const avatarFileName = await characterStore.importCharacter(file);
      if (avatarFileName) {
        importedAvatars.push(avatarFileName);
      }
    } catch (error: any) {
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

onMounted(() => {
  characterStore.refreshCharacters();
  uiStore.menuType = 'characters';
  // TODO: Load initial pin state from settings store / local storage
});
</script>

<template>
  <div class="u-flex u-flex-nowrap">
    <div class="u-flex-col u-flex u-items-start">
      <div :title="t('characterPanel.pinToggle')">
        <label>
          <input type="checkbox" v-model="isPanelPinned" hidden />
          <div class="menu-button-icon" :class="isPanelPinned ? 'fa-lock' : 'fa-unlock'"></div>
        </label>
      </div>
      <div class="menu-button-icon fa-solid fa-list-ul" :title="t('characterPanel.selectCharacter')"></div>
    </div>
    <div class="u-items-center u-flex u-mx-auto u-w-full u-justify-evenly">
      <div :title="t('characterPanel.hotSwaps')">
        <small>
          <span> <i class="fa-solid fa-star"></i>&nbsp;{{ t('characterPanel.hotSwaps') }}</span>
        </small>
      </div>
    </div>
  </div>

  <!-- Name Block -->
  <div v-if="characterStore.activeCharacter && !showCharacterList" class="name-block">
    <div class="name-block__inner">
      <div class="name-block__name">
        <h2 :title="activeCharacterName">{{ activeCharacterName }}</h2>
      </div>
      <div class="name-block__info">
        <div class="name-block__token-text" :title="t('characterPanel.tokenInfo')">
          <div>
            <strong :class="{ 'neutral-warning': showTokenWarning }" :title="t('characterPanel.totalTokens')">{{
              totalTokens
            }}</strong>
            <span>&nbsp;{{ t('common.tokens') }}</span>
          </div>
          <div>
            <small :title="t('characterPanel.permanentTokens')">
              ({{ permanentTokens }}&nbsp;{{ t('common.permanent') }})
            </small>
          </div>
        </div>
        <a
          v-show="showTokenWarning"
          class="menu-button fa-solid fa-triangle-exclamation"
          href="https://docs.sillytavern.app/usage/core-concepts/characterdesign/#character-tokens"
          target="_blank"
          :title="t('characterPanel.aboutTokens')"
        ></a>
        <!-- TODO: Implement stats popup -->
        <i class="menu-button fa-solid fa-ranking-star" :title="t('characterPanel.stats')"></i>
        <!-- TODO: Implement hide panel logic -->
        <i class="menu-button fa-solid fa-eye" :title="t('characterPanel.togglePanel')"></i>
      </div>
    </div>
  </div>

  <div class="character-panel">
    <div v-show="showCharacterList" class="u-flex-col u-w-full" style="height: 100%">
      <div class="character-panel__header">
        <div class="character-panel__actions">
          <div :title="t('characterPanel.createNew')" class="menu-button fa-solid fa-user-plus"></div>
          <div
            @click="triggerImport"
            :title="t('characterPanel.importFile')"
            class="menu-button fa-solid fa-file-import"
          ></div>
          <input ref="fileInput" type="file" @change="handleFileImport" accept=".json,.png" multiple hidden />
          <div :title="t('characterPanel.importUrl')" class="menu-button fa-solid fa-cloud-arrow-down"></div>
          <div :title="t('characterPanel.createGroup')" class="menu-button fa-solid fa-users-gear"></div>
          <div id="extension-buttons-container">
            <!-- Container for additional buttons added by extensions -->
          </div>
          <select class="text-pole character-sort-order" :title="t('characterPanel.sorting.title')">
            <option value="search" hidden>{{ t('characterPanel.sorting.search') }}</option>
            <option value="name:asc">{{ t('characterPanel.sorting.nameAsc') }}</option>
            <option value="name:desc">{{ t('characterPanel.sorting.nameDesc') }}</option>
            <option value="create_date:desc">{{ t('characterPanel.sorting.newest') }}</option>
            <option value="create_date:asc">{{ t('characterPanel.sorting.oldest') }}</option>
            <option value="fav:desc">{{ t('characterPanel.sorting.favorites') }}</option>
            <option value="date_last_chat:desc">{{ t('characterPanel.sorting.recent') }}</option>
            <option value="chat_size:desc">{{ t('characterPanel.sorting.mostChats') }}</option>
            <option value="chat_size:asc">{{ t('characterPanel.sorting.leastChats') }}</option>
            <option value="data_size:desc">{{ t('characterPanel.sorting.mostTokens') }}</option>
            <option value="data_size:asc">{{ t('characterPanel.sorting.leastTokens') }}</option>
            <option value="random">{{ t('characterPanel.sorting.random') }}</option>
          </select>
          <div
            class="menu-button-icon fa-fw fa-solid fa-search character-search-toggle"
            :title="t('characterPanel.searchToggle')"
            @click="isSearchActive = !isSearchActive"
          ></div>
        </div>
        <div class="character-panel__search-form" :class="{ active: isSearchActive }">
          <input class="text-pole u-w-full" type="search" :placeholder="t('characterPanel.searchPlaceholder')" />
        </div>
        <div class="tag-controls">
          <div></div>
          <div></div>
        </div>
      </div>

      <div class="character-panel__pagination">
        <i class="fa-solid fa-table-cells-large menu-button" :title="t('characterPanel.gridView')"></i>
        <i class="fa-solid fa-edit menu-button" :title="t('characterPanel.bulkEdit')"></i>
        <Pagination
          v-if="characterStore.displayableEntities.length > 0"
          :total-items="characterStore.displayableEntities.length"
          v-model:current-page="characterStore.currentPage"
          v-model:items-per-page="characterStore.itemsPerPage"
          :items-per-page-options="[10, 25, 50, 100]"
        />
        <i
          class="fa-solid fa-check-double menu-button"
          :title="t('characterPanel.bulkSelectAll')"
          style="display: none"
        ></i>
        <i class="fa-solid fa-trash menu-button" :title="t('characterPanel.bulkDelete')" style="display: none"></i>
      </div>
      <div class="character-panel__character-list">
        <div v-if="characterStore.paginatedEntities.length === 0">{{ t('common.loading') }}</div>
        <template v-for="entity in characterStore.paginatedEntities" :key="entity.id">
          <!-- Character Block -->
          <div
            v-if="entity.type === 'character'"
            class="character-item"
            :data-avatar="(entity.item as Character).avatar"
            @click="characterStore.selectCharacterById(entity.id as number)"
            tabindex="0"
            role="listitem"
          >
            <div class="character-item__avatar">
              <img
                :src="getThumbnailUrl('avatar', (entity.item as Character).avatar)"
                :alt="`${(entity.item as Character).name} Avatar`"
              />
            </div>
            <div class="character-item__content">
              <div class="character-item__header">
                <span class="character-item__name" :title="(entity.item as Character).name">{{
                  (entity.item as Character).name
                }}</span>
                <i class="character-item__fav-icon fa-solid fa-star" v-if="(entity.item as Character).fav"></i>
              </div>
              <div class="character-item__description">
                {{ (entity.item as Character).data?.creator_notes || '' }}
              </div>
              <div class="character-item__tags" v-if="(entity.item as Character).tags?.length">
                <span v-for="tag in (entity.item as Character).tags" :key="tag" class="tag">{{ tag }}</span>
              </div>
            </div>
          </div>

          <!-- Group Block -->
          <div v-if="entity.type === 'group'" class="character-item">
            <!-- TODO: Group rendering logic here -->
            <div class="character-item__name">GROUP: {{ (entity.item as Group).id }}</div>
          </div>
        </template>
      </div>
    </div>
    <CharacterEditForm v-show="!showCharacterList" />
  </div>
</template>
