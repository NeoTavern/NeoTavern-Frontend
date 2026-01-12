<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { computed, nextTick, onMounted, ref, watch, type CSSProperties } from 'vue';
import LoginView from './components/Login/LoginView.vue';
import NavBar from './components/NavBar/NavBar.vue';
import Popup from './components/Popup/Popup.vue';
import SidebarHost from './components/Shared/SidebarHost.vue';
import ToastContainer from './components/Toast/ToastContainer.vue';
import { Button } from './components/UI';
import { useAppRegistration } from './composables/useAppRegistration';
import { useStrictI18n } from './composables/useStrictI18n';
import { useToastState } from './composables/useToast';
import { useApiStore } from './stores/api.store';
import { useAuthStore } from './stores/auth.store';
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
const authStore = useAuthStore();
const { t } = useStrictI18n();
const { registerCoreComponents } = useAppRegistration();
const { toasts } = useToastState();

// TODO: i18n

// PWA Update Logic
const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegistered(r) {
    // Check for updates every hour
    if (r) {
      setInterval(
        () => {
          r.update();
        },
        60 * 60 * 1000,
      );
    }
  },
});

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

async function initializeAppData() {
  isInitializing.value = true;
  await settingsStore.initializeSettings();

  if (settingsStore.settings.ui.forceMobileMode) {
    document.body.classList.add('force-mobile-layout');
  }
  watch(
    () => settingsStore.settings.ui.forceMobileMode,
    (newValue) => {
      if (newValue) {
        document.body.classList.add('force-mobile-layout');
      } else {
        document.body.classList.remove('force-mobile-layout');
      }
    },
  );

  try {
    await Promise.all([
      secretStore.fetchSecrets(),
      chatStore.refreshChats(),
      apiStore.initialize(),
      apiStore.loadPresetsForApi(),
      apiStore.loadInstructTemplates(),
      apiStore.loadReasoningTemplates(),
      backgroundStore.initialize(),
      worldInfoStore.initialize(),
      personaStore.initialize(),
      themeStore.fetchThemes(),
    ]);
    themeStore.loadCurrentDOMStyles();
  } catch (error) {
    console.error('Failed to initialize app data', error);
  } finally {
    isInitializing.value = false;
  }

  await nextTick();
  await extensionStore.initializeExtensions();
}

onMounted(async () => {
  registerCoreComponents();

  if (authStore.needsLogin) {
    isInitializing.value = false;
    watch(
      () => authStore.needsLogin,
      async (needsLogin) => {
        if (!needsLogin) {
          await initializeAppData();
        }
      },
    );
    return;
  }

  await initializeAppData();
});
</script>

<template>
  <div id="background" :style="backgroundStyle" aria-hidden="true"></div>

  <!-- App Initialization Loading Overlay -->
  <div v-show="isInitializing" class="app-initializing-overlay" aria-live="assertive" role="alert" aria-busy="true">
    <div class="loading-spinner">
      <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
      <span>{{ t('common.loading') }}</span>
    </div>
  </div>

  <template v-if="authStore.needsLogin">
    <LoginView />
  </template>

  <!-- 
    Flex Layout Wrapper 
    This creates the structure: [NavBar] [LeftSidebar] [MainContent] [RightSidebar]
  -->
  <div v-else-if="!isInitializing" id="app-layout">
    <NavBar />

    <SidebarHost side="left" />

    <!-- Main Content Area -->
    <main
      id="main-content"
      :class="{
        'full-screen': isFullScreen,
      }"
      role="main"
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

  <!-- PWA Update Notification -->
  <div v-if="needRefresh" class="pwa-toast" role="alert">
    <div class="pwa-message">New version available</div>
    <div class="pwa-actions">
      <Button variant="confirm" @click="updateServiceWorker(true)"> Reload </Button>
      <Button variant="ghost" @click="needRefresh = false"> Close </Button>
    </div>
  </div>

  <ToastContainer :toasts="toasts" />
</template>

<style>
.pwa-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background-color: var(--theme-background-tint);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 250px;
}

.pwa-message {
  color: var(--theme-text-color);
  font-weight: bold;
}

.pwa-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
