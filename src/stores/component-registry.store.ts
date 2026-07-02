import { defineStore } from 'pinia';
import { markRaw, ref, type Component, type Ref } from 'vue';
import type { NavBarItemDefinition, SidebarDefinition } from '../types';
import type {
  ChatFormOptionsMenuItemDefinition,
  ChatQuickActionDefinition,
  TextareaToolDefinition,
} from '../types/ExtensionAPI';
import type { CodeMirrorTarget } from '../types/settings';

export interface ChatSettingsTabDefinition {
  id: string;
  title: string;
  component: Component;
}

interface RegexToolRegistration {
  regex: RegExp;
  tools: TextareaToolDefinition[];
}

export interface ChatQuickActionGroupDefinition {
  id: string;
  label: string;
  actions: ChatQuickActionDefinition[];
  visible?: boolean;
}

interface ComponentRegistryStoreSetup {
  leftSidebarRegistry: Ref<Map<string, SidebarDefinition>>;
  rightSidebarRegistry: Ref<Map<string, SidebarDefinition>>;
  navBarRegistry: Ref<Map<string, NavBarItemDefinition>>;
  textareaToolRegistry: Ref<Map<string, TextareaToolDefinition[]>>;
  textareaToolRegexRegistry: Ref<RegexToolRegistration[]>;
  chatSettingsTabRegistry: Ref<Map<string, ChatSettingsTabDefinition>>;
  chatFormOptionsMenuRegistry: Ref<Map<string, ChatFormOptionsMenuItemDefinition>>;
  chatQuickActionsRegistry: Ref<Map<string, ChatQuickActionGroupDefinition>>;
  registerSidebar: (id: string, definition: Omit<SidebarDefinition, 'id'>, side: 'left' | 'right') => void;
  unregisterSidebar: (id: string, side: 'left' | 'right') => void;
  registerNavBarItem: (id: string, definition: Omit<NavBarItemDefinition, 'id'>) => void;
  unregisterNavBarItem: (id: string) => void;
  registerTextareaTool: (identifier: CodeMirrorTarget | string | RegExp, definition: TextareaToolDefinition) => void;
  unregisterTextareaTool: (identifier: CodeMirrorTarget | string | RegExp, toolId: string) => void;
  getTextareaTools: (identifier: string) => TextareaToolDefinition[];
  registerChatFormOptionsMenuItem: (item: ChatFormOptionsMenuItemDefinition) => void;
  unregisterChatFormOptionsMenuItem: (id: string) => void;
  registerChatQuickAction: (groupId: string, groupLabel: string, action: ChatQuickActionDefinition) => void;
  unregisterChatQuickAction: (groupId: string, actionId: string) => void;
  registerChatSettingsTab: (id: string, title: string, component: Component) => void;
  unregisterChatSettingsTab: (id: string) => void;
  getNavBarItem: (id: string) => NavBarItemDefinition | undefined;
}

export const useComponentRegistryStore = defineStore('component-registry', (): ComponentRegistryStoreSetup => {
  const leftSidebarRegistry = ref<Map<string, SidebarDefinition>>(new Map());
  const rightSidebarRegistry = ref<Map<string, SidebarDefinition>>(new Map());
  const navBarRegistry = ref<Map<string, NavBarItemDefinition>>(new Map());

  // Exact match registry
  const textareaToolRegistry = ref<Map<string, TextareaToolDefinition[]>>(new Map());
  // Regex match registry
  const textareaToolRegexRegistry = ref<RegexToolRegistration[]>([]);

  const chatSettingsTabRegistry = ref<Map<string, ChatSettingsTabDefinition>>(new Map());
  const chatFormOptionsMenuRegistry = ref<Map<string, ChatFormOptionsMenuItemDefinition>>(new Map());
  const chatQuickActionsRegistry = ref<Map<string, ChatQuickActionGroupDefinition>>(new Map());

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

  function registerTextareaTool(identifier: CodeMirrorTarget | string | RegExp, definition: TextareaToolDefinition) {
    if (identifier instanceof RegExp) {
      // Handle Regex registration
      const existingEntry = textareaToolRegexRegistry.value.find((entry) => {
        return entry.regex.toString() === identifier.toString();
      });

      if (existingEntry) {
        // Update if exists, else add
        const toolIndex = existingEntry.tools.findIndex((t) => t.id === definition.id);
        if (toolIndex !== -1) {
          existingEntry.tools[toolIndex] = definition;
        } else {
          existingEntry.tools.push(definition);
        }
      } else {
        textareaToolRegexRegistry.value.push({
          regex: identifier,
          tools: [definition],
        });
      }
    } else {
      // Handle Exact String registration
      const list = textareaToolRegistry.value.get(identifier) || [];
      // Update if exists, else add
      const toolIndex = list.findIndex((t) => t.id === definition.id);
      if (toolIndex !== -1) {
        list[toolIndex] = definition;
      } else {
        list.push(definition);
      }
      textareaToolRegistry.value.set(identifier, list);
    }
  }

  function unregisterTextareaTool(identifier: CodeMirrorTarget | string | RegExp, toolId: string) {
    if (identifier instanceof RegExp) {
      const entryIndex = textareaToolRegexRegistry.value.findIndex(
        (entry) => entry.regex.toString() === identifier.toString(),
      );
      if (entryIndex === -1) return;

      const entry = textareaToolRegexRegistry.value[entryIndex];
      const newTools = entry.tools.filter((t) => t.id !== toolId);

      if (newTools.length === 0) {
        textareaToolRegexRegistry.value.splice(entryIndex, 1);
      } else {
        entry.tools = newTools;
      }
    } else {
      const list = textareaToolRegistry.value.get(identifier);
      if (!list) return;
      const newList = list.filter((t) => t.id !== toolId);
      if (newList.length === 0) {
        textareaToolRegistry.value.delete(identifier);
      } else {
        textareaToolRegistry.value.set(identifier, newList);
      }
    }
  }

  function getTextareaTools(identifier: string): TextareaToolDefinition[] {
    const exactTools = textareaToolRegistry.value.get(identifier) || [];

    // Collect tools from all matching regexes
    const regexTools = textareaToolRegexRegistry.value
      .filter((entry) => entry.regex.test(identifier))
      .flatMap((entry) => entry.tools);

    // Combine and deduplicate by ID
    const allTools = [...exactTools, ...regexTools];
    const uniqueTools = new Map<string, TextareaToolDefinition>();

    for (const tool of allTools) {
      if (!uniqueTools.has(tool.id)) {
        uniqueTools.set(tool.id, tool);
      }
    }

    return Array.from(uniqueTools.values());
  }

  function registerChatFormOptionsMenuItem(item: ChatFormOptionsMenuItemDefinition) {
    chatFormOptionsMenuRegistry.value.set(item.id, item);
  }

  function unregisterChatFormOptionsMenuItem(id: string) {
    chatFormOptionsMenuRegistry.value.delete(id);
  }

  function registerChatQuickAction(groupId: string, groupLabel: string, action: ChatQuickActionDefinition) {
    let group = chatQuickActionsRegistry.value.get(groupId);
    if (!group) {
      group = { id: groupId, label: groupLabel, actions: [] };
      chatQuickActionsRegistry.value.set(groupId, group);
    }
    // Update if exists, else add
    const actionIndex = group.actions.findIndex((a) => a.id === action.id);
    if (actionIndex !== -1) {
      group.actions[actionIndex] = action;
    } else {
      group.actions.push(action);
    }
  }

  function unregisterChatQuickAction(groupId: string, actionId: string) {
    const group = chatQuickActionsRegistry.value.get(groupId);
    if (!group) return;

    group.actions = group.actions.filter((a) => a.id !== actionId);

    // If group becomes empty, remove it
    if (group.actions.length === 0) {
      chatQuickActionsRegistry.value.delete(groupId);
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
    textareaToolRegexRegistry,
    chatSettingsTabRegistry,
    chatFormOptionsMenuRegistry,
    chatQuickActionsRegistry,
    registerSidebar,
    unregisterSidebar,
    registerNavBarItem,
    unregisterNavBarItem,
    registerTextareaTool,
    unregisterTextareaTool,
    getTextareaTools,
    registerChatFormOptionsMenuItem,
    unregisterChatFormOptionsMenuItem,
    registerChatQuickAction,
    unregisterChatQuickAction,
    registerChatSettingsTab,
    unregisterChatSettingsTab,
    getNavBarItem: (id: string) => navBarRegistry.value.get(id),
  };
});
