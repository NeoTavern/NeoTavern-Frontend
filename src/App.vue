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

const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const uiStore = useUiStore();
const backgroundStore = useBackgroundStore();

const backgroundStyle = computed(() => ({
  backgroundImage: backgroundStore.currentBackgroundUrl,
}));

onMounted(() => {
  settingsStore.initializeSettings();

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
});
</script>

<template>
  <div id="background" :style="backgroundStyle"></div>
  <Navbar />

  <AppSidebar side="left" :is-open="uiStore.isLeftSidebarOpen" storage-key="character_browser_width">
    <template v-for="[id, def] in uiStore.leftSidebarRegistry" :key="id">
      <div v-show="uiStore.leftSidebarView === id" style="height: 100%">
        <component :is="def.component" v-bind="def.componentProps" />
      </div>
    </template>
  </AppSidebar>

  <!-- Main Layout -->
  <main id="main-content">
    <ChatHeader />
    <div class="content-wrapper">
      <ChatInterface />
    </div>
    <template v-for="avatar in uiStore.zoomedAvatars" :key="avatar.id">
      <ZoomedAvatar :avatar="avatar" />
    </template>
  </main>

  <AppSidebar side="right" :is-open="uiStore.isRightSidebarOpen" storage-key="extensions_browser_width">
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
