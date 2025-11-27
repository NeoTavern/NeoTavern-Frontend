import { defineStore } from 'pinia';
import { markRaw, ref } from 'vue';
import type { NavBarItemDefinition, SidebarDefinition } from '../types';

export const useComponentRegistryStore = defineStore('component-registry', () => {
  const leftSidebarRegistry = ref<Map<string, SidebarDefinition>>(new Map());
  const rightSidebarRegistry = ref<Map<string, SidebarDefinition>>(new Map());
  const navBarRegistry = ref<Map<string, NavBarItemDefinition>>(new Map());

  function registerSidebar(id: string, definition: Omit<SidebarDefinition, 'id'>, side: 'left' | 'right') {
    const rawComponent = markRaw(definition.component);
    const registry = side === 'left' ? leftSidebarRegistry : rightSidebarRegistry;
    const layoutId = side === 'right' ? (definition.layoutId ?? 'chat') : definition.layoutId;
    registry.value.set(id, { ...definition, component: rawComponent, layoutId, id });
  }

  function unregisterSidebar(id: string, side: 'left' | 'right') {
    const registry = side === 'left' ? leftSidebarRegistry : rightSidebarRegistry;
    registry.value.delete(id);
  }

  function registerNavBarItem(id: string, definition: Omit<NavBarItemDefinition, 'id'>) {
    navBarRegistry.value.set(id, {
      ...definition,
      component: definition.component ? markRaw(definition.component) : undefined,
      layoutComponent: definition.layoutComponent ? markRaw(definition.layoutComponent) : undefined,
      id,
    });
  }

  function unregisterNavBarItem(id: string) {
    navBarRegistry.value.delete(id);
  }

  return {
    leftSidebarRegistry,
    rightSidebarRegistry,
    navBarRegistry,
    registerSidebar,
    unregisterSidebar,
    registerNavBarItem,
    unregisterNavBarItem,
    getNavBarItem: (id: string) => navBarRegistry.value.get(id),
  };
});
