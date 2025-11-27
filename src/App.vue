<script setup lang="ts">
import { computed, onMounted, type CSSProperties } from 'vue';
import CharacterPanel from './components/CharacterPanel/CharacterPanel.vue';
import ChatManagement from './components/Chat/ChatManagement.vue';
import RecentChats from './components/Chat/RecentChats.vue';
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
import { useComponentRegistryStore } from './stores/component-registry.store';
import { useExtensionStore } from './stores/extension.store';
import { useLayoutStore } from './stores/layout.store';
import { usePopupStore } from './stores/popup.store';
import { useSecretStore } from './stores/secret.store';
import { useSettingsStore } from './stores/settings.store';

const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const layoutStore = useLayoutStore();
const registryStore = useComponentRegistryStore();
const backgroundStore = useBackgroundStore();
const extensionStore = useExtensionStore();
const secretStore = useSecretStore();
const { t } = useStrictI18n();

const backgroundStyle = computed<CSSProperties>(() => {
  const fitting = backgroundStore.fitting;
  let size = 'cover';
  let repeat = 'no-repeat';
  let position = 'center center';

  switch (fitting) {
    case 'contain':
      size = 'contain';
      break;
    case 'stretch':
      size = '100% 100%';
      break;
    case 'center':
      size = 'auto';
      break;
    case 'cover':
    case 'classic':
    default:
      size = 'cover';
      break;
  }

  return {
    backgroundImage: backgroundStore.currentBackgroundUrl,
    backgroundSize: size,
    backgroundRepeat: repeat,
    backgroundPosition: position,
  };
});

const isFullScreen = computed(() => settingsStore.settings.account.chatFullScreen);

const allMainLayouts = computed(() => {
  return Array.from(registryStore.navBarRegistry.entries())
    .filter(([, item]) => !!item.layoutComponent)
    .map(([id, item]) => ({
      id,
      component: item.layoutComponent,
      props: item.layoutProps ?? {},
    }));
});

const activeRightSidebars = computed(() =>
  Array.from(registryStore.rightSidebarRegistry).filter(
    ([, def]) => (def.layoutId ?? 'chat') === layoutStore.activeMainLayout,
  ),
);

onMounted(() => {
  settingsStore.initializeSettings();
  extensionStore.initializeExtensions();
  secretStore.fetchSecrets();

  // Register Left Sidebar
  registryStore.registerSidebar(
    'recent-chats',
    {
      component: RecentChats,
      title: 'Recent Chats',
      icon: 'fa-comments',
    },
    'left',
  );

  registryStore.registerSidebar(
    'user-settings',
    {
      component: UserSettingsDrawer,
      title: t('navbar.userSettings'),
      icon: 'fa-user-cog',
    },
    'left',
  );

  registryStore.registerSidebar(
    'ai-config',
    {
      component: AiConfigDrawer,
      title: t('navbar.aiConfig'),
      icon: 'fa-sliders',
    },
    'left',
  );

  registryStore.registerSidebar(
    'character-side',
    {
      component: CharacterPanel,
      componentProps: { mode: 'side-only' },
      title: t('navbar.characterManagement'),
      icon: 'fa-address-card',
    },
    'left',
  );

  registryStore.registerSidebar(
    'world-info-side',
    {
      component: WorldInfoDrawer,
      componentProps: { mode: 'side-only' },
      title: t('navbar.worldInfo'),
      icon: 'fa-book-atlas',
    },
    'left',
  );

  registryStore.registerSidebar(
    'extensions-side',
    {
      component: ExtensionsDrawer,
      componentProps: { mode: 'side-only' },
      title: t('navbar.extensions'),
      icon: 'fa-cubes',
    },
    'left',
  );

  registryStore.registerSidebar(
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
  registryStore.registerSidebar(
    'chat-management',
    {
      component: ChatManagement,
      title: t('chat.optionsMenu.manageChats'),
      icon: 'fa-address-book',
      layoutId: 'chat',
    },
    'right',
  );

  registryStore.registerSidebar(
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
  registryStore.registerNavBarItem('chat', {
    icon: 'fa-comments',
    title: t('navbar.chat'),
    layoutComponent: ChatMainLayout,
    defaultSidebarId: 'recent-chats',
  });

  registryStore.registerNavBarItem('character', {
    icon: 'fa-address-card',
    title: t('navbar.characterManagement'),
    layoutComponent: CharacterPanel,
    layoutProps: { mode: 'main-only' },
    defaultSidebarId: 'character-side',
  });

  registryStore.registerNavBarItem('world-info', {
    icon: 'fa-book-atlas',
    title: t('navbar.worldInfo'),
    layoutComponent: WorldInfoDrawer,
    layoutProps: { mode: 'main-only' },
    defaultSidebarId: 'world-info-side',
  });

  registryStore.registerNavBarItem('extensions', {
    icon: 'fa-cubes',
    title: t('navbar.extensions'),
    layoutComponent: ExtensionsDrawer,
    layoutProps: { mode: 'main-only' },
    defaultSidebarId: 'extensions-side',
  });

  registryStore.registerNavBarItem('persona', {
    icon: 'fa-face-smile',
    title: t('navbar.personaManagement'),
    layoutComponent: PersonaManagementDrawer,
    layoutProps: { mode: 'main-only' },
    defaultSidebarId: 'persona-side',
  });

  // Register NavBar Items (Floating sidebars only)
  registryStore.registerNavBarItem('ai-config-nav', {
    icon: 'fa-sliders',
    title: t('navbar.aiConfig'),
    targetSidebarId: 'ai-config',
  });

  registryStore.registerNavBarItem('user-settings-nav', {
    icon: 'fa-user-cog',
    title: t('navbar.userSettings'),
    targetSidebarId: 'user-settings',
  });

  // Since ActivateNavBarItem logic now resides in LayoutStore but needs registry access,
  // we check if we can call it via UIStore facade or LayoutStore directly.
  // The layoutStore internally uses registryStore.
  layoutStore.activateNavBarItem('chat');
});
</script>

<template>
  <div id="background" :style="backgroundStyle"></div>
  <NavBar />

  <Sidebar side="left" :is-open="layoutStore.isLeftSidebarOpen" storage-key="leftSidebarWidth">
    <template v-for="[id, def] in registryStore.leftSidebarRegistry" :key="id">
      <div v-show="layoutStore.leftSidebarView === id" :id="`sidebar-left-${id}`" style="height: 100%">
        <component :is="def.component" v-bind="{ title: def.title, ...def.componentProps }" />
      </div>
    </template>
  </Sidebar>

  <!-- Main Layout -->
  <main
    id="main-content"
    :class="{
      'full-screen': isFullScreen,
      'left-open': layoutStore.isLeftSidebarOpen,
      'right-open': layoutStore.isRightSidebarOpen,
    }"
  >
    <!--
      We wrap the layout component in a div to ensure v-show works correctly 
      even if the component has multiple root nodes (fragments), which avoids Vue warnings.
    -->
    <div
      v-for="layout in allMainLayouts"
      v-show="layoutStore.activeMainLayout === layout.id"
      :key="layout.id"
      style="height: 100%; width: 100%"
    >
      <component :is="layout.component" v-bind="layout.props" />
    </div>
  </main>

  <Sidebar side="right" :is-open="layoutStore.isRightSidebarOpen" storage-key="rightSidebarWidth">
    <template v-for="[id, def] in activeRightSidebars" :key="id">
      <div v-show="layoutStore.rightSidebarView === id" style="height: 100%">
        <component :is="def.component" v-bind="{ title: def.title, ...def.componentProps }" />
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
