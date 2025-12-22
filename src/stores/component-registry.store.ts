import { defineStore } from 'pinia';
import { markRaw, ref, type Component } from 'vue';
import type { NavBarItemDefinition, SidebarDefinition } from '../types';
import type { TextareaToolDefinition } from '../types/ExtensionAPI';
import type { CodeMirrorTarget } from '../types/settings';

export interface ChatSettingsTabDefinition {
  id: string;
  title: string;
  component: Component;
}

export const useComponentRegistryStore = defineStore('component-registry', () => {
  const leftSidebarRegistry = ref<Map<string, SidebarDefinition>>(new Map());
  const rightSidebarRegistry = ref<Map<string, SidebarDefinition>>(new Map());
  const navBarRegistry = ref<Map<string, NavBarItemDefinition>>(new Map());
  const textareaToolRegistry = ref<Map<string, TextareaToolDefinition[]>>(new Map());
  const chatSettingsTabRegistry = ref<Map<string, ChatSettingsTabDefinition>>(new Map());

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

  function registerTextareaTool(identifier: CodeMirrorTarget | string, definition: TextareaToolDefinition) {
    const list = textareaToolRegistry.value.get(identifier) || [];
    // Prevent duplicates by ID
    const exists = list.find((t) => t.id === definition.id);
    if (exists) return;
    list.push(definition);
    textareaToolRegistry.value.set(identifier, list);
  }

  function unregisterTextareaTool(identifier: CodeMirrorTarget | string, toolId: string) {
    const list = textareaToolRegistry.value.get(identifier);
    if (!list) return;
    const newList = list.filter((t) => t.id !== toolId);
    if (newList.length === 0) {
      textareaToolRegistry.value.delete(identifier);
    } else {
      textareaToolRegistry.value.set(identifier, newList);
    }
  }

  function registerChatSettingsTab(id: string, title: string, component: Component) {
    chatSettingsTabRegistry.value.set(id, {
      id,
      title,
      component: markRaw(component),
    });
  }

  function unregisterChatSettingsTab(id: string) {
    chatSettingsTabRegistry.value.delete(id);
  }

  return {
    leftSidebarRegistry,
    rightSidebarRegistry,
    navBarRegistry,
    textareaToolRegistry,
    chatSettingsTabRegistry,
    registerSidebar,
    unregisterSidebar,
    registerNavBarItem,
    unregisterNavBarItem,
    registerTextareaTool,
    unregisterTextareaTool,
    registerChatSettingsTab,
    unregisterChatSettingsTab,
    getNavBarItem: (id: string) => navBarRegistry.value.get(id),
  };
});
