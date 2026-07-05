import { onMounted, onUnmounted, ref } from 'vue';
import type { MythicExtensionAPI, MythicMessageExtraData } from '../types';

export const MYTHIC_EXTRA_KEY = 'core.mythic-agents';

type MythicExtraPatch = Record<string, unknown> | ((currentExtra: MythicMessageExtraData) => Record<string, unknown>);

export function stripMythicExtra<T extends Record<string, unknown> | undefined>(extra: T): T {
  if (!extra?.[MYTHIC_EXTRA_KEY]) return extra;
  const nextExtra = { ...extra, [MYTHIC_EXTRA_KEY]: undefined };
  return nextExtra as T;
}

export function useMythicState(api: MythicExtensionAPI) {
  const state = ref<MythicMessageExtraData>();

  function updateState() {
    const history = api.chat.getHistory();
    state.value = undefined;
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.extra?.[MYTHIC_EXTRA_KEY]) {
        state.value = msg.extra[MYTHIC_EXTRA_KEY];
        break;
      }
    }
  }

  function getLatestMythicMessageIndex(): number | null {
    const history = api.chat.getHistory();
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].extra?.[MYTHIC_EXTRA_KEY]) {
        return i;
      }
    }
    return null;
  }

  function saveExtraAt(index: number, extra: MythicMessageExtraData) {
    const message = api.chat.getHistory()[index];
    if (!message) return false;

    const nextExtra = {
      ...message.extra,
      [MYTHIC_EXTRA_KEY]: extra,
    };
    api.chat.updateMessageObject(index, { extra: nextExtra });
    return true;
  }

  function updateLatestExtra(update: MythicExtraPatch) {
    const mythicIndex = getLatestMythicMessageIndex();
    if (mythicIndex === null) return false;

    const currentExtra = api.chat.getHistory()[mythicIndex]?.extra?.[MYTHIC_EXTRA_KEY];
    if (!currentExtra) return false;

    const patch = typeof update === 'function' ? update(currentExtra) : update;
    return saveExtraAt(mythicIndex, { ...currentExtra, ...patch } as MythicMessageExtraData);
  }

  function upsertLatestOrLastExtra(extra: MythicMessageExtraData) {
    const history = api.chat.getHistory();
    if (history.length === 0) return false;

    const mythicIndex = getLatestMythicMessageIndex();
    if (mythicIndex === null) {
      return saveExtraAt(history.length - 1, extra);
    }

    return updateLatestExtra(extra);
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

  return { state, getLatestMythicMessageIndex, updateLatestExtra, upsertLatestOrLastExtra };
}
