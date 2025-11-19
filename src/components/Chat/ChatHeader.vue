<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '../../stores/ui.store';
import { useCharacterStore } from '../../stores/character.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { getThumbnailUrl } from '@/utils/image';

const uiStore = useUiStore();
const characterStore = useCharacterStore();
const { t } = useStrictI18n();

const activeCharacter = computed(() => characterStore.activeCharacter);
const avatarUrl = computed(() => getThumbnailUrl('avatar', activeCharacter.value?.avatar || ''));

const lastMessageDate = computed(() => {
  // TODO: Not character, get first/last message date from chat store
  return activeCharacter.value?.create_date || '';
});

function handleChatManagement() {
  uiStore.toggleLeftSidebar();
}

function handleAiConfig() {
  uiStore.toggleRightSidebar('ai-config');
}

function handleCharacterClick() {
  // TODO:: Expand/collapse logic if needed, or open character details in sidebar
}
</script>

<template>
  <header class="chat-header">
    <div class="chat-header-group left">
      <i
        class="chat-header-icon fa-solid fa-comments"
        :class="{ active: uiStore.isLeftSidebarOpen }"
        :title="t('navbar.chatManagement')"
        @click="handleChatManagement"
      ></i>
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
        class="chat-header-icon fa-solid fa-sliders"
        :class="{ active: uiStore.rightSidebarView === 'ai-config' }"
        :title="t('navbar.aiConfig')"
        @click="handleAiConfig"
      ></i>
    </div>
  </header>
</template>
