import CharacterPanel from '../components/CharacterPanel/CharacterPanel.vue';
import ChatManagement from '../components/Chat/ChatManagement.vue';
import RecentChats from '../components/Chat/RecentChats.vue';
import ChatMainLayout from '../components/Layout/ChatMainLayout.vue';
import AiConfigDrawer from '../components/NavBar/AiConfigDrawer.vue';
import BackgroundsDrawer from '../components/NavBar/BackgroundsDrawer.vue';
import ExtensionsDrawer from '../components/NavBar/ExtensionsDrawer.vue';
import PersonaManagementDrawer from '../components/NavBar/PersonaManagementDrawer.vue';
import ThemeDrawer from '../components/NavBar/ThemeDrawer.vue';
import UserSettingsDrawer from '../components/NavBar/UserSettingsDrawer.vue';
import WorldInfoDrawer from '../components/NavBar/WorldInfoDrawer.vue';
import { useComponentRegistryStore } from '../stores/component-registry.store';
import { useLayoutStore } from '../stores/layout.store';
import { useStrictI18n } from './useStrictI18n';

export function useAppRegistration() {
  const registryStore = useComponentRegistryStore();
  const layoutStore = useLayoutStore();
  const { t } = useStrictI18n();

  const registerCoreComponents = () => {
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

    // Register Theme Drawer
    registryStore.registerSidebar(
      'themes',
      {
        component: ThemeDrawer,
        title: t('themes.title'),
        icon: 'fa-palette',
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

    registryStore.registerNavBarItem('themes-nav', {
      icon: 'fa-palette',
      title: 'Themes',
      targetSidebarId: 'themes',
    });

    // Default activation
    layoutStore.activateNavBarItem('chat');
  };

  return { registerCoreComponents };
}
