import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface ChatMessageEditState {
  index: number;
  originalContent: string;
}

export const useChatUiStore = defineStore('chat-ui', () => {
  const isChatLoading = ref(false);
  const activeMessageEditState = ref<ChatMessageEditState | null>(null);

  function startEditing(index: number, content: string) {
    activeMessageEditState.value = {
      index,
      originalContent: content,
    };
  }

  function cancelEditing() {
    activeMessageEditState.value = null;
  }

  return {
    isChatLoading,
    activeMessageEditState,
    startEditing,
    cancelEditing,
  };
});
