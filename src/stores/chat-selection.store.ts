import { defineStore } from 'pinia';
import { ref } from 'vue';

export type SelectionModeType = 'free' | 'range';

export const useChatSelectionStore = defineStore('chat-selection', () => {
  const isSelectionMode = ref(false);
  const selectionModeType = ref<SelectionModeType>('free');
  const selectedMessageIndices = ref<Set<number>>(new Set());

  function toggleSelectionMode() {
    isSelectionMode.value = !isSelectionMode.value;
    selectedMessageIndices.value.clear();
    selectionModeType.value = 'free';
  }

  function setSelectionType(type: SelectionModeType) {
    selectionModeType.value = type;
    selectedMessageIndices.value.clear();
  }

  function toggleMessageSelection(index: number, totalMessages: number) {
    if (!isSelectionMode.value) return;

    if (selectionModeType.value === 'range') {
      // Range Mode: Select from index to end of chat
      selectedMessageIndices.value.clear();
      for (let i = index; i < totalMessages; i++) {
        selectedMessageIndices.value.add(i);
      }
    } else {
      // Free Mode: Toggle individual message
      if (selectedMessageIndices.value.has(index)) {
        selectedMessageIndices.value.delete(index);
      } else {
        selectedMessageIndices.value.add(index);
      }
    }
  }

  function selectAll(totalMessages: number) {
    selectedMessageIndices.value.clear();
    for (let i = 0; i < totalMessages; i++) {
      selectedMessageIndices.value.add(i);
    }
  }

  function deselectAll() {
    selectedMessageIndices.value.clear();
  }

  return {
    isSelectionMode,
    selectionModeType,
    selectedMessageIndices,
    toggleSelectionMode,
    setSelectionType,
    toggleMessageSelection,
    selectAll,
    deselectAll,
  };
});
