import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { useComponentRegistryStore } from './component-registry.store';

type RightSidebarState = {
  isOpen: boolean;
  view: string | null;
};

export const useLayoutStore = defineStore('layout', () => {
  const registryStore = useComponentRegistryStore();

  const activeDrawer = ref<string | null>(null);
  const activeMainLayout = ref<string>('chat');

  const isLeftSidebarOpen = ref(false);
  const leftSidebarView = ref<string | null>(null);

  const rightSidebarStateByLayout = reactive<Record<string, RightSidebarState>>({});

  function getRightSidebarState(layoutId = activeMainLayout.value): RightSidebarState {
    if (!rightSidebarStateByLayout[layoutId]) {
      rightSidebarStateByLayout[layoutId] = { isOpen: false, view: null };
    }
    return rightSidebarStateByLayout[layoutId];
  }

  const isRightSidebarOpen = computed(() => getRightSidebarState().isOpen);
  const rightSidebarView = computed(() => getRightSidebarState().view);

  function toggleLeftSidebar(viewId: string) {
    if (!registryStore.leftSidebarRegistry.has(viewId)) return;

    if (isLeftSidebarOpen.value && leftSidebarView.value === viewId) {
      isLeftSidebarOpen.value = false;
      leftSidebarView.value = null;
    } else {
      isLeftSidebarOpen.value = true;
      leftSidebarView.value = viewId;
      activeDrawer.value = null;
    }
  }

  function closeLeftSidebar() {
    isLeftSidebarOpen.value = false;
    leftSidebarView.value = null;
  }

  function cleanupRightSidebarForLayout(layoutId: string) {
    const state = getRightSidebarState(layoutId);
    // If current view is invalid for this layout, close it
    if (state.view) {
      const def = registryStore.rightSidebarRegistry.get(state.view);
      if (def && (def.layoutId ?? 'chat') !== layoutId) {
        state.isOpen = false;
        state.view = null;
      }
    }
  }

  function toggleRightSidebar(viewId: string) {
    const layoutId = activeMainLayout.value;
    const def = registryStore.rightSidebarRegistry.get(viewId);

    if (!def || (def.layoutId ?? 'chat') !== layoutId) return;

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

  /**
   * Central handler for all NavBar interactions.
   * Determines if the click should switch layout, toggle sidebar, or toggle drawer.
   */
  function activateNavBarItem(itemId: string) {
    const item = registryStore.navBarRegistry.get(itemId);
    if (!item) return;

    // 1. Custom Handler
    if (item.onClick) {
      item.onClick();
    }

    // 2. Main Layout Switcher
    if (item.layoutComponent) {
      if (activeMainLayout.value === itemId) {
        // Already active? Toggle the default sidebar if one exists
        if (item.defaultSidebarId) toggleLeftSidebar(item.defaultSidebarId);
      } else {
        // Switch layout
        activeMainLayout.value = itemId;
        activeDrawer.value = null; // Close any open drawers
        cleanupRightSidebarForLayout(itemId);

        // Open default sidebar for this layout if defined
        if (item.defaultSidebarId) {
          isLeftSidebarOpen.value = true;
          leftSidebarView.value = item.defaultSidebarId;
        } else {
          isLeftSidebarOpen.value = false;
        }
      }
      return;
    }

    // 3. Floating Sidebar Toggle
    if (item.targetSidebarId) {
      toggleLeftSidebar(item.targetSidebarId);
      return;
    }

    // 4. Drawer/Modal Toggle
    if (item.component) {
      activeDrawer.value = activeDrawer.value === itemId ? null : itemId;
    }
  }

  return {
    activeDrawer,
    activeMainLayout,
    isLeftSidebarOpen,
    leftSidebarView,
    isRightSidebarOpen,
    rightSidebarView,
    toggleLeftSidebar,
    closeLeftSidebar,
    toggleRightSidebar,
    closeRightSidebar,
    cleanupRightSidebarForLayout,
    activateNavBarItem,
  };
});
