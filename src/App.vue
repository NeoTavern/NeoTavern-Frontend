<script setup lang="ts">
import { computed, onMounted, ref, type CSSProperties } from 'vue';
import NavBar from './components/NavBar/NavBar.vue';
import Popup from './components/Popup/Popup.vue';
import SidebarHost from './components/Shared/SidebarHost.vue';
import { useAppRegistration } from './composables/useAppRegistration';
import { useStrictI18n } from './composables/useStrictI18n';
import { useApiStore } from './stores/api.store';
import { useBackgroundStore } from './stores/background.store';
import { useChatStore } from './stores/chat.store';
import { useComponentRegistryStore } from './stores/component-registry.store';
import { useExtensionStore } from './stores/extension.store';
import { useLayoutStore } from './stores/layout.store';
import { usePersonaStore } from './stores/persona.store';
import { usePopupStore } from './stores/popup.store';
import { useSecretStore } from './stores/secret.store';
import { useSettingsStore } from './stores/settings.store';
import { useThemeStore } from './stores/theme.store';
import { useWorldInfoStore } from './stores/world-info.store';

const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const layoutStore = useLayoutStore();
const registryStore = useComponentRegistryStore();
const backgroundStore = useBackgroundStore();
const extensionStore = useExtensionStore();
const apiStore = useApiStore();
const personaStore = usePersonaStore();
const worldInfoStore = useWorldInfoStore();
const secretStore = useSecretStore();
const chatStore = useChatStore();
const themeStore = useThemeStore();
const { t } = useStrictI18n();
const { registerCoreComponents } = useAppRegistration();

const isInitializing = ref(true);

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

onMounted(async () => {
  registerCoreComponents();

  await settingsStore.initializeSettings();

  await Promise.all([
    secretStore.fetchSecrets(),
    chatStore.refreshChats(),
    apiStore.initialize(),
    apiStore.loadPresetsForApi(),
    apiStore.loadInstructTemplates(),
    backgroundStore.initialize(),
    worldInfoStore.initialize(),
    personaStore.initialize(),
    themeStore.fetchThemes(),
  ]);
  themeStore.loadCurrentDOMStyles();

  await extensionStore.initializeExtensions();

  // Mark initialization as complete
  isInitializing.value = false;
});
</script>

<template>
  <div id="background" :style="backgroundStyle"></div>

  <!-- App Initialization Loading Overlay -->
  <div v-show="isInitializing" class="app-initializing-overlay">
    <div class="loading-spinner">
      <i class="fa-solid fa-circle-notch fa-spin"></i>
      <span>{{ t('common.loading') }}</span>
    </div>
  </div>

  <!-- 
    Flex Layout Wrapper 
    This creates the structure: [NavBar] [LeftSidebar] [MainContent] [RightSidebar]
  -->
  <div id="app-layout">
    <NavBar />

    <SidebarHost side="left" />

    <!-- Main Content Area -->
    <main
      id="main-content"
      :class="{
        'full-screen': isFullScreen,
      }"
    >
      <!--
        The layout components are centered within main-content via CSS.
        We use v-show to maintain DOM state for extensions.
      -->
      <div
        v-for="layout in allMainLayouts"
        v-show="layoutStore.activeMainLayout === layout.id"
        :key="layout.id"
        class="layout-view-wrapper"
      >
        <component :is="layout.component" v-bind="layout.props" />
      </div>
    </main>

    <SidebarHost side="right" />
  </div>

  <template v-for="popup in popupStore.popups" :key="popup.id">
    <Popup
      v-bind="popup"
      @submit="(payload: any) => popupStore.confirm(popup.id, payload)"
      @close="popupStore.cancel(popup.id)"
    />
  </template>
</template>
