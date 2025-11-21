<script setup lang="ts">
import Navbar from './components/NavBar/NavBar.vue';
import ChatInterface from './components/Chat/ChatInterface.vue';
import Popup from './components/Popup/Popup.vue';
import ZoomedAvatar from './components/ZoomedAvatar.vue';
import AppSidebar from './components/Shared/AppSidebar.vue';
import ChatHeader from './components/Chat/ChatHeader.vue';
import AiConfigDrawer from './components/NavBar/AiConfigDrawer.vue';
import RecentChats from './components/Chat/RecentChats.vue';
import { onMounted, computed } from 'vue';
import { useSettingsStore } from './stores/settings.store';
import { usePopupStore } from './stores/popup.store';
import { useUiStore } from './stores/ui.store';
import { useBackgroundStore } from './stores/background.store';
import ChatManagement from './components/Chat/ChatManagement.vue';
import { useStrictI18n } from './composables/useStrictI18n';

const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const uiStore = useUiStore();
const backgroundStore = useBackgroundStore();
const { t } = useStrictI18n();

const backgroundStyle = computed(() => ({
  backgroundImage: backgroundStore.currentBackgroundUrl,
}));

const isFullScreen = computed(() => settingsStore.settings.account.chatFullScreen);

onMounted(() => {
  settingsStore.initializeSettings();

  // TODO: Add i18n
  uiStore.registerSidebar(
    'recent-chats',
    {
      component: RecentChats,
      title: 'Recent Chats',
      icon: 'fa-comments',
    },
    'left',
  );

  uiStore.registerSidebar(
    'ai-config',
    {
      component: AiConfigDrawer,
      title: 'AI Configuration',
      icon: 'fa-sliders',
    },
    'right',
  );

  uiStore.registerSidebar(
    'chat-management',
    {
      component: ChatManagement,
      title: t('chat.optionsMenu.manageChats'),
      icon: 'fa-address-book',
    },
    'right',
  );
});
</script>

<template>
  <div id="background" :style="backgroundStyle"></div>
  <Navbar />

  <AppSidebar side="left" :is-open="uiStore.isLeftSidebarOpen" storage-key="leftSidebarWidth">
    <template v-for="[id, def] in uiStore.leftSidebarRegistry" :key="id">
      <div v-show="uiStore.leftSidebarView === id" style="height: 100%">
        <component :is="def.component" v-bind="def.componentProps" />
      </div>
    </template>
  </AppSidebar>

  <!-- Main Layout -->
  <main
    id="main-content"
    :class="{
      'full-screen': isFullScreen,
      'left-open': uiStore.isLeftSidebarOpen,
      'right-open': uiStore.isRightSidebarOpen,
    }"
  >
    <ChatHeader />
    <div class="content-wrapper">
      <ChatInterface />
    </div>
    <template v-for="avatar in uiStore.zoomedAvatars" :key="avatar.id">
      <ZoomedAvatar :avatar="avatar" />
    </template>
  </main>

  <AppSidebar side="right" :is-open="uiStore.isRightSidebarOpen" storage-key="rightSidebarWidth">
    <template v-for="[id, def] in uiStore.rightSidebarRegistry" :key="id">
      <div v-show="uiStore.rightSidebarView === id" style="height: 100%">
        <component :is="def.component" v-bind="def.componentProps" />
      </div>
    </template>
  </AppSidebar>

  <template v-for="popup in popupStore.popups" :key="popup.id">
    <Popup
      v-bind="popup"
      @submit="(payload: any) => popupStore.confirm(popup.id, payload)"
      @close="popupStore.cancel(popup.id)"
    />
  </template>
</template>

<style lang="scss" scoped>
.content-wrapper {
  height: calc(100% - var(--header-height));
  position: relative;
}
</style>
