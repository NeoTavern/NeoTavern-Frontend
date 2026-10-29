import { onMounted, onUnmounted } from 'vue';

/**
 * Calls `onOutside` when a document-level pointer event lands outside all of `elements`
 * (typically a popover and the control that opens it). Missing elements are ignored.
 */
export function useClickOutside(
  elements: () => ReadonlyArray<Element | null | undefined>,
  onOutside: () => void,
  eventName: 'click' | 'mousedown' = 'click',
) {
  const handler = (event: Event) => {
    const target = event.target as Node;
    if (elements().some((element) => element?.contains(target))) return;
    onOutside();
  };
  onMounted(() => document.addEventListener(eventName, handler));
  onUnmounted(() => document.removeEventListener(eventName, handler));
}
