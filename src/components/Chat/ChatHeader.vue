<script setup lang="ts">
import { computed } from 'vue';
import { useCharacterUiStore } from '../../stores/character-ui.store';
import { useCharacterStore } from '../../stores/character.store';
import { useChatStore } from '../../stores/chat.store';
import { useComponentRegistryStore } from '../../stores/component-registry.store';
import { useGroupChatStore } from '../../stores/group-chat.store';
import { useLayoutStore } from '../../stores/layout.store';
import { getThumbnailUrl } from '../../utils/character';
import { formatTimeStamp } from '../../utils/commons';
import { MainContentFullscreenToggle, SmartAvatar } from '../common';
import { Button } from '../UI';

const layoutStore = useLayoutStore();
const componentRegistryStore = useComponentRegistryStore();
const characterStore = useCharacterStore();
const characterUiStore = useCharacterUiStore();
const chatStore = useChatStore();
const groupChatStore = useGroupChatStore();

const firstCharacter = computed(() => characterStore.activeCharacters?.[0]);

const isGroup = computed(() => groupChatStore.isGroupChat);

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

const rightSidebarItems = computed(() =>
  Array.from(componentRegistryStore.rightSidebarRegistry).filter(
    ([, def]) => (def.layoutId ?? 'chat') === layoutStore.activeMainLayout,
  ),
);

const lastMessageDate = computed(() => {
  const messages = chatStore.activeChat?.messages;
  if (!messages || messages.length === 0) return '';
  const lastMsg = messages[messages.length - 1];
  return formatTimeStamp(lastMsg.send_date || lastMsg.gen_finished || Date.now());
});

function handleCharacterClick() {
  if (isGroup.value) {
    layoutStore.toggleRightSidebar('chat-management');
  } else if (firstCharacter.value) {
    characterUiStore.selectedCharacterAvatarForEditing = firstCharacter.value.avatar;
    layoutStore.activateNavBarItem('character');
  }
}
</script>

<template>
  <header class="main-page-header chat-header">
    <div class="chat-header-group left">
      <MainContentFullscreenToggle class="chat-header-icon" />
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
      <template v-for="[id, def] in rightSidebarItems" :key="id">
        <Button
          v-if="def.icon"
          variant="ghost"
          class="chat-header-icon"
          :icon="def.icon"
          :active="layoutStore.rightSidebarView === id"
          :title="def.title"
          @click="layoutStore.toggleRightSidebar(id)"
        />
      </template>
    </div>
  </header>
</template>
