import { defineStore } from 'pinia';
import { computed, markRaw, reactive, ref } from 'vue';
import type { NavBarItemDefinition, SidebarDefinition, ZoomedAvatar } from '../types';

type RightSidebarState = {
  isOpen: boolean;
  view: string | null;
};

export const useUiStore = defineStore('ui', () => {
  const isChatSaving = ref<boolean>(false);
  const isDeleteMode = ref<boolean>(false);
  const isSendPress = ref<boolean>(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cropData = ref<any>(null); // TODO: Proper type
  const activePlayerName = ref<string | null>(null);
  const activePlayerAvatar = ref<string | null>(null);
  const zoomedAvatars = ref<ZoomedAvatar[]>([]);

  const activeDrawer = ref<string | null>(null);
  const activeMainLayout = ref<string>('chat');

  const isLeftSidebarOpen = ref(false);
  const leftSidebarView = ref<string | null>(null);
  const floatingLeftSidebarView = ref<string | null>(null);

  const rightSidebarStateByLayout = reactive<Record<string, RightSidebarState>>({});

  const leftSidebarRegistry = ref<Map<string, SidebarDefinition>>(new Map());
  const rightSidebarRegistry = ref<Map<string, SidebarDefinition>>(new Map());
  const navBarRegistry = ref<Map<string, NavBarItemDefinition>>(new Map());

  function getRightSidebarState(layoutId = activeMainLayout.value): RightSidebarState {
    if (!rightSidebarStateByLayout[layoutId]) {
      rightSidebarStateByLayout[layoutId] = { isOpen: false, view: null };
    }
    return rightSidebarStateByLayout[layoutId];
  }

  function sidebarMatchesLayout(definition: SidebarDefinition, layoutId: string) {
    // Default right sidebars to the chat layout unless explicitly specified.
    const targetLayout = definition.layoutId ?? 'chat';
    return targetLayout === layoutId;
  }

  function cleanupRightSidebarForLayout(layoutId: string) {
    const state = getRightSidebarState(layoutId);
    const availableIds = Array.from(rightSidebarRegistry.value.entries())
      .filter(([, def]) => sidebarMatchesLayout(def, layoutId))
      .map(([sidebarId]) => sidebarId);

    if (!availableIds.length || (state.view && !availableIds.includes(state.view))) {
      state.isOpen = false;
      state.view = null;
    }
  }

  function registerSidebar(id: string, definition: Omit<SidebarDefinition, 'id'>, side: 'left' | 'right') {
    const rawComponent = markRaw(definition.component);
    const registry = side === 'left' ? leftSidebarRegistry : rightSidebarRegistry;
    const layoutId = side === 'right' ? definition.layoutId ?? 'chat' : definition.layoutId;
    registry.value.set(id, { ...definition, component: rawComponent, layoutId, id });
    if (side === 'right') {
      cleanupRightSidebarForLayout(activeMainLayout.value);
    }
  }

  function unregisterSidebar(id: string, side: 'left' | 'right') {
    const registry = side === 'left' ? leftSidebarRegistry : rightSidebarRegistry;
    registry.value.delete(id);

    if (side === 'left' && leftSidebarView.value === id) {
      closeLeftSidebar();
    } else if (side === 'right') {
      Object.keys(rightSidebarStateByLayout).forEach((layoutId) => {
        const state = getRightSidebarState(layoutId);
        if (state.view === id) {
          state.view = null;
          state.isOpen = false;
        }
      });
      cleanupRightSidebarForLayout(activeMainLayout.value);
    }
  }

  function registerNavBarItem(id: string, definition: Omit<NavBarItemDefinition, 'id'>) {
    const rawComponent = definition.component ? markRaw(definition.component) : undefined;
    const rawLayoutComponent = definition.layoutComponent ? markRaw(definition.layoutComponent) : undefined;
    navBarRegistry.value.set(id, {
      ...definition,
      component: rawComponent,
      layoutComponent: rawLayoutComponent,
      id,
    });
  }

  function unregisterNavBarItem(id: string) {
    navBarRegistry.value.delete(id);
    if (activeDrawer.value === id) {
      activeDrawer.value = null;
    }
  }

  function getNavBarItem(id: string) {
    return navBarRegistry.value.get(id);
  }

  function toggleLeftSidebar(viewId?: string) {
    if (!viewId) {
      if (leftSidebarView.value) {
        isLeftSidebarOpen.value = false;
        leftSidebarView.value = null;
        floatingLeftSidebarView.value = null;
        return;
      }
      viewId = 'recent-chats';
      if (!leftSidebarRegistry.value.has(viewId)) {
        viewId = leftSidebarRegistry.value.keys().next().value;
      }
    }

    if (!viewId) return;

    if (isLeftSidebarOpen.value && leftSidebarView.value === viewId) {
      isLeftSidebarOpen.value = false;
      leftSidebarView.value = null;
      if (floatingLeftSidebarView.value === viewId) {
        floatingLeftSidebarView.value = null;
      }
    } else {
      if (leftSidebarRegistry.value.has(viewId)) {
        isLeftSidebarOpen.value = true;
        leftSidebarView.value = viewId;
        if (floatingLeftSidebarView.value && floatingLeftSidebarView.value !== viewId) {
          floatingLeftSidebarView.value = null;
        }
      }
    }
  }

  function closeLeftSidebar() {
    isLeftSidebarOpen.value = false;
    leftSidebarView.value = null;
    floatingLeftSidebarView.value = null;
  }

  function toggleRightSidebar(viewId: string) {
    const layoutId = activeMainLayout.value;
    const definition = rightSidebarRegistry.value.get(viewId);

    if (!definition) {
      console.warn(`[UiStore] Attempted to open non-existent right sidebar: ${viewId}`);
      return;
    }

    if (!sidebarMatchesLayout(definition, layoutId)) {
      console.warn(
        `[UiStore] Attempted to open right sidebar "${viewId}" not available for layout "${layoutId}"`,
      );
      return;
    }

    const state = getRightSidebarState(layoutId);
    if (state.isOpen && state.view === viewId) {
      state.isOpen = false;
      state.view = null;
    } else {
      state.isOpen = true;
      state.view = viewId;
    }
  }

  function closeRightSidebar() {
    const state = getRightSidebarState(activeMainLayout.value);
    state.isOpen = false;
    state.view = null;
  }

  function toggleZoomedAvatar(avatarData: Omit<ZoomedAvatar, 'id'>) {
    const id = avatarData.charName;
    const existingIndex = zoomedAvatars.value.findIndex((avatar) => avatar.id === id);

    if (existingIndex > -1) {
      zoomedAvatars.value.splice(existingIndex, 1);
    } else {
      zoomedAvatars.value.push({ ...avatarData, id });
    }
  }

  function removeZoomedAvatar(id: string) {
    const index = zoomedAvatars.value.findIndex((avatar) => avatar.id === id);
    if (index > -1) {
      zoomedAvatars.value.splice(index, 1);
    }
  }

  function setActiveMainLayout(id: string, sidebarId?: string) {
    if (!navBarRegistry.value.has(id)) {
      console.warn(`[UiStore] Attempted to open non-existent main layout: ${id}`);
      return;
    }

    activeMainLayout.value = id;
    activeDrawer.value = null;
    floatingLeftSidebarView.value = null;

    const fallbackSidebar = sidebarId ?? navBarRegistry.value.get(id)?.defaultSidebarId;
    if (fallbackSidebar && leftSidebarRegistry.value.has(fallbackSidebar)) {
      isLeftSidebarOpen.value = true;
      leftSidebarView.value = fallbackSidebar;
    }

    cleanupRightSidebarForLayout(id);
  }

  function openFloatingLeftSidebar(viewId: string) {
    if (!leftSidebarRegistry.value.has(viewId)) {
      console.warn(`[UiStore] Attempted to open non-existent floating sidebar: ${viewId}`);
      return;
    }
    floatingLeftSidebarView.value = viewId;
    isLeftSidebarOpen.value = true;
    leftSidebarView.value = viewId;
  }

  const isRightSidebarOpen = computed(() => getRightSidebarState().isOpen);
  const rightSidebarView = computed(() => getRightSidebarState().view);

  return {
    isChatSaving,
    isDeleteMode,
    isSendPress,
    activeDrawer,
    activeMainLayout,
    cropData,
    activePlayerName,
    activePlayerAvatar,
    zoomedAvatars,
    floatingLeftSidebarView,

    // Sidebar State
    isLeftSidebarOpen,
    leftSidebarView,
    isRightSidebarOpen,
    rightSidebarView,

    // Registries
    leftSidebarRegistry,
    rightSidebarRegistry,
    navBarRegistry,

    // Actions
    registerSidebar,
    unregisterSidebar,
    registerNavBarItem,
    unregisterNavBarItem,
    getNavBarItem,
    toggleLeftSidebar,
    closeLeftSidebar,
    toggleRightSidebar,
    closeRightSidebar,
    setActiveMainLayout,
    openFloatingLeftSidebar,

    toggleZoomedAvatar,
    removeZoomedAvatar,
  };
});
