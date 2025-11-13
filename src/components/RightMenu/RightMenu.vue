<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useCharacterStore } from '../../stores/character.store';
import { useUiStore } from '../../stores/ui.store';
import type { Character, Group } from '../../types';
import CharacterEditForm from './CharacterEditForm.vue';
import { getThumbnailUrl } from '../../utils/image';

const characterStore = useCharacterStore();
const uiStore = useUiStore();
const isSearchActive = ref(false);
const isPanelPinned = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const showCharacterList = computed(() => {
  return uiStore.menuType !== 'character_edit' && uiStore.menuType !== 'create';
});

const totalTokens = computed(() => characterStore.totalTokens);
const permanentTokens = computed(() => characterStore.permanentTokens);
const activeCharacterName = computed(() => characterStore.activeCharacter?.name);

// TODO: Get max_context from a settings store
const maxContext = ref(12000);
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
      <div title="Locked = Character Management panel will stay open">
        <input id="right-menu-pin-toggle" type="checkbox" v-model="isPanelPinned" />
        <label for="right-menu-pin-toggle">
          <div class="menu-button-icon" :class="isPanelPinned ? 'fa-lock' : 'fa-unlock'"></div>
        </label>
      </div>
      <div class="menu-button-icon fa-solid fa-list-ul" title="Select/Create Characters"></div>
    </div>
    <div class="u-items-center u-flex u-mx-auto u-w-full u-justify-evenly">
      <div title="Favorite characters to add them to HotSwaps">
        <small>
          <span> <i class="fa-solid fa-star"></i>&nbsp;Favorite characters to add them to HotSwaps</span>
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
        <div class="name-block__token-text" title="Token counts may be inaccurate and provided just for reference.">
          <div>
            <strong :class="{ 'neutral-warning': showTokenWarning }" title="Total tokens">{{ totalTokens }}</strong>
            <span>&nbsp;Tokens</span>
          </div>
          <div>
            <small title="Permanent tokens"> ({{ permanentTokens }}&nbsp;Permanent) </small>
          </div>
        </div>
        <a
          v-show="showTokenWarning"
          class="menu-button fa-solid fa-triangle-exclamation"
          href="https://docs.sillytavern.app/usage/core-concepts/characterdesign/#character-tokens"
          target="_blank"
          title="About Token 'Limits'"
        ></a>
        <!-- TODO: Implement stats popup -->
        <i class="menu-button fa-solid fa-ranking-star" title="Click for stats!"></i>
        <!-- TODO: Implement hide panel logic -->
        <i class="menu-button fa-solid fa-eye" title="Toggle character info panel"></i>
      </div>
    </div>
  </div>

  <div id="right-menu-panel" class="right-menu-panel">
    <div v-show="showCharacterList" class="u-flex-col u-w-full" style="height: 100%">
      <div class="right-menu-panel__header">
        <div class="right-menu-panel__actions">
          <div title="Create New Character" class="menu-button fa-solid fa-user-plus"></div>
          <div
            @click="triggerImport"
            title="Import Character from File"
            class="menu-button fa-solid fa-file-import"
          ></div>
          <input ref="fileInput" type="file" @change="handleFileImport" accept=".json,.png" multiple hidden />
          <div title="Import content from external URL" class="menu-button fa-solid fa-cloud-arrow-down"></div>
          <div title="Create New Chat Group" class="menu-button fa-solid fa-users-gear"></div>
          <div id="extension-buttons-container">
            <!-- Container for additional buttons added by extensions -->
          </div>
          <select id="character-sort-order" class="text-pole" title="Characters sorting order">
            <option value="search" hidden>Search</option>
            <option value="name:asc">A-Z</option>
            <option value="name:desc">Z-A</option>
            <option value="create_date:desc">Newest</option>
            <option value="create_date:asc">Oldest</option>
            <option value="fav:desc">Favorites</option>
            <option value="date_last_chat:desc">Recent</option>
            <option value="chat_size:desc">Most chats</option>
            <option value="chat_size:asc">Least chats</option>
            <option value="data_size:desc">Most tokens</option>
            <option value="data_size:asc">Least tokens</option>
            <option value="random">Random</option>
          </select>
          <div
            id="character-search-toggle"
            class="menu-button-icon fa-fw fa-solid fa-search"
            title="Toggle search bar"
            @click="isSearchActive = !isSearchActive"
          ></div>
        </div>
        <div id="character-search-form" :class="{ active: isSearchActive }">
          <input class="text-pole u-w-full" type="search" placeholder="Search..." />
        </div>
        <div class="tag-controls">
          <div></div>
          <div></div>
        </div>
      </div>

      <div class="right-menu-panel__pagination">
        <i class="fa-solid fa-table-cells-large menu-button" title="Toggle character grid view"></i>
        <i
          class="fa-solid fa-edit menu-button"
          title="Bulk edit characters&#13;&#13;Click to toggle characters&#13;Shift + Click to select/deselect a range of characters&#13;Right-click for actions"
        ></i>
        <div></div>
        <i class="fa-solid fa-check-double menu-button" title="Bulk select all characters" style="display: none"></i>
        <i class="fa-solid fa-trash menu-button" title="Bulk delete characters" style="display: none"></i>
      </div>
      <div id="character-list" class="u-flex-col">
        <div v-if="characterStore.displayableEntities.length === 0">Loading...</div>
        <template v-for="entity in characterStore.displayableEntities" :key="entity.id">
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
            <!-- Group rendering logic here -->
            <div class="character-item__name">GROUP: {{ (entity.item as Group).id }}</div>
          </div>
        </template>
      </div>
    </div>
    <CharacterEditForm v-show="!showCharacterList" />
  </div>
</template>
