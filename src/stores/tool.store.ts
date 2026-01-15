import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ToolDefinition } from '../types/tools';
import { eventEmitter } from '../utils/extensions';
import { useSettingsStore } from './settings.store';

export const useToolStore = defineStore('tool', () => {
  const tools = ref<Map<string, ToolDefinition>>(new Map());
  const settingsStore = useSettingsStore();

  const toolList = computed(() => Array.from(tools.value.values()));

  const enabledTools = computed(() => {
    return toolList.value.filter((tool) => !settingsStore.settings.disabledTools.includes(tool.name));
  });

  async function registerTool(tool: ToolDefinition) {
    if (tools.value.has(tool.name)) {
      console.warn(`[ToolStore] Overwriting existing tool: ${tool.name}`);
    }
    tools.value.set(tool.name, tool);
    await eventEmitter.emit('tool:registered', tool);
  }

  async function unregisterTool(name: string) {
    if (tools.value.delete(name)) {
      await eventEmitter.emit('tool:unregistered', name);
    }
  }

  function getTool(name: string): ToolDefinition | undefined {
    return tools.value.get(name);
  }

  function isToolDisabled(name: string): boolean {
    return settingsStore.settings.disabledTools.includes(name);
  }

  function toggleTool(name: string, enable?: boolean) {
    if (!tools.value.has(name)) return;

    const currentlyDisabled = isToolDisabled(name);
    const shouldEnable = enable !== undefined ? enable : currentlyDisabled;

    // Create a new array to trigger reactivity in settings
    const newDisabledList = new Set(settingsStore.settings.disabledTools);

    if (shouldEnable) {
      newDisabledList.delete(name);
    } else {
      newDisabledList.add(name);
    }

    settingsStore.settings.disabledTools = Array.from(newDisabledList);
  }

  return {
    tools,
    toolList,
    enabledTools,
    registerTool,
    unregisterTool,
    getTool,
    isToolDisabled,
    toggleTool,
  };
});
