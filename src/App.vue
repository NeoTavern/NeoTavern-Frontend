<script setup lang="ts">
import { computed, onMounted } from 'vue';
import ChatManagement from './components/Chat/ChatManagement.vue';
import RecentChats from './components/Chat/RecentChats.vue';
import CharacterPanel from './components/CharacterPanel/CharacterPanel.vue';
import ChatMainLayout from './components/Layout/ChatMainLayout.vue';
import AiConfigDrawer from './components/NavBar/AiConfigDrawer.vue';
import BackgroundsDrawer from './components/NavBar/BackgroundsDrawer.vue';
import ExtensionsDrawer from './components/NavBar/ExtensionsDrawer.vue';
import NavBar from './components/NavBar/NavBar.vue';
import PersonaManagementDrawer from './components/NavBar/PersonaManagementDrawer.vue';
import UserSettingsDrawer from './components/NavBar/UserSettingsDrawer.vue';
import WorldInfoDrawer from './components/NavBar/WorldInfoDrawer.vue';
import Popup from './components/Popup/Popup.vue';
import Sidebar from './components/Shared/Sidebar.vue';
import { useStrictI18n } from './composables/useStrictI18n';
import { useBackgroundStore } from './stores/background.store';
import { usePopupStore } from './stores/popup.store';
import { useSettingsStore } from './stores/settings.store';
import { useUiStore } from './stores/ui.store';

const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const uiStore = useUiStore();
const backgroundStore = useBackgroundStore();
const { t } = useStrictI18n();

const backgroundStyle = computed(() => ({
  backgroundImage: backgroundStore.currentBackgroundUrl,
}));

const isFullScreen = computed(() => settingsStore.settings.account.chatFullScreen);

const currentMainLayoutComponent = computed(() => {
  return uiStore.getNavBarItem(uiStore.activeMainLayout)?.layoutComponent ?? ChatMainLayout;
});

const currentMainLayoutProps = computed(() => {
  return uiStore.getNavBarItem(uiStore.activeMainLayout)?.layoutProps ?? {};
});

const activeRightSidebars = computed(() =>
  Array.from(uiStore.rightSidebarRegistry).filter(
    ([, def]) => (def.layoutId ?? 'chat') === uiStore.activeMainLayout,
  ),
);

onMounted(() => {
  settingsStore.initializeSettings();

  // Register Left Sidebar
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
    'user-settings',
    {
      component: UserSettingsDrawer,
      title: t('navbar.userSettings'),
      icon: 'fa-user-cog',
    },
    'left',
  );

  uiStore.registerSidebar(
    'ai-config',
    {
      component: AiConfigDrawer,
      title: t('navbar.aiConfig'),
      icon: 'fa-sliders',
    },
    'left',
  );

  uiStore.registerSidebar(
    'character-side',
    {
      component: CharacterPanel,
      componentProps: { mode: 'side-only' },
      title: t('navbar.characterManagement'),
      icon: 'fa-address-card',
    },
    'left',
  );

  uiStore.registerSidebar(
    'world-info-side',
    {
      component: WorldInfoDrawer,
      componentProps: { mode: 'side-only' },
      title: t('navbar.worldInfo'),
      icon: 'fa-book-atlas',
    },
    'left',
  );

  uiStore.registerSidebar(
    'extensions-side',
    {
      component: ExtensionsDrawer,
      componentProps: { mode: 'side-only' },
      title: t('navbar.extensions'),
      icon: 'fa-cubes',
    },
    'left',
  );

  uiStore.registerSidebar(
    'persona-side',
    {
      component: PersonaManagementDrawer,
      componentProps: { mode: 'side-only' },
      title: t('navbar.personaManagement'),
      icon: 'fa-face-smile',
    },
    'left',
  );

  // Register Right Sidebars
  uiStore.registerSidebar(
    'chat-management',
    {
      component: ChatManagement,
      title: t('chat.optionsMenu.manageChats'),
      icon: 'fa-address-book',
      layoutId: 'chat',
    },
    'right',
  );

  uiStore.registerSidebar(
    'backgrounds',
    {
      component: BackgroundsDrawer,
      title: t('navbar.backgrounds'),
      icon: 'fa-panorama',
      layoutId: 'chat',
    },
    'right',
  );

  // Register NavBar Items (Top/Main Layouts)
  uiStore.registerNavBarItem('chat', {
    icon: 'fa-comments',
    title: t('navbar.chat'),
    section: 'main',
    layoutComponent: ChatMainLayout,
    defaultSidebarId: 'recent-chats',
  });

  uiStore.registerNavBarItem('character', {
    icon: 'fa-address-card',
    title: t('navbar.characterManagement'),
    section: 'main',
    layoutComponent: CharacterPanel,
    layoutProps: { mode: 'main-only' },
    defaultSidebarId: 'character-side',
  });

  uiStore.registerNavBarItem('world-info', {
    icon: 'fa-book-atlas',
    title: t('navbar.worldInfo'),
    section: 'main',
    layoutComponent: WorldInfoDrawer,
    layoutProps: { mode: 'main-only' },
    defaultSidebarId: 'world-info-side',
  });

  uiStore.registerNavBarItem('extensions', {
    icon: 'fa-cubes',
    title: t('navbar.extensions'),
    section: 'main',
    layoutComponent: ExtensionsDrawer,
    layoutProps: { mode: 'main-only' },
    defaultSidebarId: 'extensions-side',
  });

  uiStore.registerNavBarItem('persona', {
    icon: 'fa-face-smile',
    title: t('navbar.personaManagement'),
    section: 'main',
    layoutComponent: PersonaManagementDrawer,
    layoutProps: { mode: 'main-only' },
    defaultSidebarId: 'persona-side',
  });

  // Register NavBar Items (Floating sidebars only)
  uiStore.registerNavBarItem('ai-config-nav', {
    icon: 'fa-sliders',
    title: t('navbar.aiConfig'),
    section: 'floating',
    targetSidebarId: 'ai-config',
  });

  uiStore.registerNavBarItem('user-settings-nav', {
    icon: 'fa-user-cog',
    title: t('navbar.userSettings'),
    section: 'floating',
    targetSidebarId: 'user-settings',
  });

  uiStore.setActiveMainLayout('chat', 'recent-chats');
});
</script>

<template>
  <div id="background" :style="backgroundStyle"></div>
  <NavBar />

  <Sidebar side="left" :is-open="uiStore.isLeftSidebarOpen" storage-key="leftSidebarWidth">
    <template v-for="[id, def] in uiStore.leftSidebarRegistry" :key="id">
      <div v-show="uiStore.leftSidebarView === id" :id="`sidebar-left-${id}`" style="height: 100%">
        <component :is="def.component" v-bind="def.componentProps" />
      </div>
    </template>
  </Sidebar>

  <!-- Main Layout -->
  <main
    id="main-content"
    :class="{
      'full-screen': isFullScreen,
      'left-open': uiStore.isLeftSidebarOpen,
      'right-open': uiStore.isRightSidebarOpen,
    }"
  >
    <component :is="currentMainLayoutComponent" v-bind="currentMainLayoutProps" />
  </main>

  <Sidebar side="right" :is-open="uiStore.isRightSidebarOpen" storage-key="rightSidebarWidth">
    <template v-for="[id, def] in activeRightSidebars" :key="id">
      <div v-show="uiStore.rightSidebarView === id" style="height: 100%">
        <component :is="def.component" v-bind="def.componentProps" />
      </div>
    </template>
  </Sidebar>

  <template v-for="popup in popupStore.popups" :key="popup.id">
    <Popup
      v-bind="popup"
      @submit="(payload: any) => popupStore.confirm(popup.id, payload)"
      @close="popupStore.cancel(popup.id)"
    />
  </template>
</template>
