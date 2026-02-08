import { onMounted, onUnmounted, ref } from 'vue';
import type { MythicExtensionAPI, MythicMessageExtraData } from '../types';

export function useMythicState(api: MythicExtensionAPI) {
  const state = ref<MythicMessageExtraData>();

  function updateState() {
    const history = api.chat.getHistory();
    state.value = undefined;
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.extra?.['core.mythic-agents']) {
        state.value = msg.extra['core.mythic-agents'];
        break;
      }
    }
  }

  function getLatestMythicMessageIndex(): number | null {
    const history = api.chat.getHistory();
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].extra?.['core.mythic-agents']) {
        return i;
      }
    }
    return null;
  }

  let unsubscribe: (() => void) | undefined;

  onMounted(() => {
    updateState();
    const unsubscribeUpdated = api.events.on('message:updated', () => updateState());
    const unsubscribeCreated = api.events.on('message:created', () => updateState());
    const unsubscribeDeleted = api.events.on('message:deleted', () => updateState());
    const unsubscribeEntered = api.events.on('chat:entered', () => updateState());
    const unsubscribeCleared = api.events.on('chat:cleared', () => updateState());
    // Combine unsubscribes
    unsubscribe = () => {
      unsubscribeUpdated();
      unsubscribeCreated();
      unsubscribeDeleted();
      unsubscribeEntered();
      unsubscribeCleared();
    };
  });

  onUnmounted(() => {
    if (unsubscribe) unsubscribe();
  });

  return { state, getLatestMythicMessageIndex };
}
