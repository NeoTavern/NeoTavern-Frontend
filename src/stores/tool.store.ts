import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ToolDefinition } from '../types/tools';
import { eventEmitter } from '../utils/extensions';

export const useToolStore = defineStore('tool', () => {
  const tools = ref<Map<string, ToolDefinition>>(new Map());
  const disabledTools = ref<Set<string>>(new Set());

  const toolList = computed(() => Array.from(tools.value.values()));

  const enabledTools = computed(() => {
    return toolList.value.filter((tool) => !tool.disabled && !disabledTools.value.has(tool.name));
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
      disabledTools.value.delete(name);
      await eventEmitter.emit('tool:unregistered', name);
    }
  }

  function getTool(name: string): ToolDefinition | undefined {
    return tools.value.get(name);
  }

  function isToolDisabled(name: string): boolean {
    return disabledTools.value.has(name);
  }

  function toggleTool(name: string, enable?: boolean) {
    if (!tools.value.has(name)) return;

    const shouldEnable = enable !== undefined ? enable : isToolDisabled(name);

    if (shouldEnable) {
      disabledTools.value.delete(name);
    } else {
      disabledTools.value.add(name);
    }
  }

  return {
    tools,
    toolList,
    disabledTools,
    enabledTools,
    registerTool,
    unregisterTool,
    getTool,
    isToolDisabled,
    toggleTool,
  };
});
