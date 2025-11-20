<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '../../stores/ui.store';
import { useCharacterStore } from '../../stores/character.store';
import { useSettingsStore } from '../../stores/settings.store';
import { getThumbnailUrl } from '@/utils/image';

const uiStore = useUiStore();
const characterStore = useCharacterStore();
const settingsStore = useSettingsStore();

const activeCharacter = computed(() => characterStore.activeCharacter);
const avatarUrl = computed(() => getThumbnailUrl('avatar', activeCharacter.value?.avatar || ''));

const lastMessageDate = computed(() => {
  // TODO: Not character, get first/last message date from chat store
  return activeCharacter.value?.create_date || '';
});

const isFullScreen = computed(() => settingsStore.getAccountItem('chat_full_screen') === 'true');

function handleCharacterClick() {
  // TODO:: Expand/collapse logic if needed, or open character details in sidebar
}

function toggleFullScreen() {
  settingsStore.setAccountItem('chat_full_screen', (!isFullScreen.value).toString());
}
</script>

<template>
  <header class="chat-header">
    <div class="chat-header-group left">
      <template v-for="[id, def] in uiStore.leftSidebarRegistry" :key="id">
        <i
          v-if="def.icon"
          class="chat-header-icon fa-solid"
          :class="[def.icon, { active: uiStore.leftSidebarView === id }]"
          :title="def.title"
          @click="uiStore.toggleLeftSidebar(id)"
        ></i>
      </template>
    </div>

    <div class="chat-header-group center" @click="handleCharacterClick">
      <div v-show="activeCharacter" class="chat-header-info">
        <img :src="avatarUrl" :alt="activeCharacter?.name" class="chat-header-info-avatar" />
        <div class="chat-header-info-text">
          <span class="chat-header-info-name">{{ activeCharacter?.name }}</span>
          <span v-show="lastMessageDate" class="chat-header-info-meta">{{ lastMessageDate }}</span>
        </div>
      </div>
    </div>

    <div class="chat-header-group right">
      <i
        class="chat-header-icon fa-solid"
        :class="isFullScreen ? 'fa-compress active' : 'fa-expand'"
        title="Toggle Full Screen"
        @click="toggleFullScreen"
      ></i>
      <template v-for="([id, def], index) in uiStore.rightSidebarRegistry" :key="index">
        <i
          v-if="def.icon"
          class="chat-header-icon fa-solid"
          :class="[def.icon, { active: uiStore.rightSidebarView === id }]"
          :title="def.title"
          @click="uiStore.toggleRightSidebar(id)"
        ></i>
      </template>
    </div>
  </header>
</template>
