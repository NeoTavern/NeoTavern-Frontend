<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '../../stores/ui.store';
import { useCharacterStore } from '../../stores/character.store';
import { useSettingsStore } from '../../stores/settings.store';
import { getThumbnailUrl } from '@/utils/image';
import { useChatStore } from '@/stores/chat.store';
import { formatTimeStamp } from '@/utils/date';
import { AppIconButton } from '../UI';
import SmartAvatar from '../Common/SmartAvatar.vue';

const uiStore = useUiStore();
const characterStore = useCharacterStore();
const settingsStore = useSettingsStore();
const chatStore = useChatStore();

const firstCharacter = computed(() => characterStore.activeCharacters?.[0]);

const isGroup = computed(() => chatStore.isGroupChat);

const headerTitle = computed(() => {
  if (isGroup.value) {
    return characterStore.activeCharacters.map((c) => c.name).join(', ');
  }
  return firstCharacter.value?.name || '';
});

const avatarUrls = computed(() => {
  if (isGroup.value) {
    return characterStore.activeCharacters.slice(0, 4).map((c) => getThumbnailUrl('avatar', c.avatar));
  }
  return [getThumbnailUrl('avatar', firstCharacter.value?.avatar || '')];
});

const lastMessageDate = computed(() => {
  const messages = chatStore.activeChat?.messages;
  if (!messages || messages.length === 0) return '';
  const lastMsg = messages[messages.length - 1];
  return formatTimeStamp(lastMsg.send_date || lastMsg.gen_finished || Date.now());
});

function handleCharacterClick() {
  if (isGroup.value) {
    uiStore.toggleRightSidebar('chat-management');
  } else if (firstCharacter.value) {
    uiStore.selectedCharacterAvatarForEditing = firstCharacter.value.avatar;
    uiStore.activeDrawer = 'character';
  }
}

function toggleFullScreen() {
  settingsStore.settings.account.chatFullScreen = !settingsStore.settings.account.chatFullScreen;
}
</script>

<template>
  <header class="chat-header">
    <div class="chat-header-group left">
      <template v-for="[id, def] in uiStore.leftSidebarRegistry" :key="id">
        <AppIconButton
          v-if="def.icon"
          class="chat-header-icon"
          :icon="def.icon"
          :active="uiStore.leftSidebarView === id"
          :title="def.title"
          @click="uiStore.toggleLeftSidebar(id)"
        />
      </template>
    </div>

    <div class="chat-header-group center" @click="handleCharacterClick">
      <div v-if="characterStore.activeCharacters.length > 0" class="chat-header-info">
        <div class="chat-header-info-avatar" :class="{ 'group-grid': isGroup }">
          <SmartAvatar :urls="avatarUrls" :alt="headerTitle" />
        </div>

        <div class="chat-header-info-text">
          <span class="chat-header-info-name" :title="headerTitle">{{ headerTitle }}</span>
          <span v-show="lastMessageDate" class="chat-header-info-meta">{{ lastMessageDate }}</span>
        </div>
      </div>
    </div>

    <div class="chat-header-group right">
      <AppIconButton
        class="chat-header-icon"
        :icon="settingsStore.settings.account.chatFullScreen ? 'fa-compress' : 'fa-expand'"
        :active="settingsStore.settings.account.chatFullScreen"
        title="Toggle Full Screen"
        @click="toggleFullScreen"
      />
      <template v-for="([id, def], index) in uiStore.rightSidebarRegistry" :key="index">
        <AppIconButton
          v-if="def.icon"
          class="chat-header-icon"
          :icon="def.icon"
          :active="uiStore.rightSidebarView === id"
          :title="def.title"
          @click="uiStore.toggleRightSidebar(id)"
        />
      </template>
    </div>
  </header>
</template>
