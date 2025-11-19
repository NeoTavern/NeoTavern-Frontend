import { onMounted, onUnmounted, type Ref } from 'vue';
import { useSettingsStore } from '../stores/settings.store';
import type { AccountStorageKey } from '../types';

interface UseResizableOptions {
  storageKey?: AccountStorageKey;
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  side?: 'left' | 'right';
}

const RESIZING_CLASS = 'is-resizing';

export function useResizable(
  element: Ref<HTMLElement | null>,
  handle: Ref<HTMLElement | null>,
  options: UseResizableOptions = {},
) {
  const { storageKey, initialWidth = 350, minWidth = 200, maxWidth = 800, side = 'left' } = options;
  const settingsStore = useSettingsStore();

  let isResizing = false;

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    isResizing = true;
    document.body.classList.add(RESIZING_CLASS);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isResizing || !element.value) return;

    const parentRect = element.value.parentElement?.getBoundingClientRect();
    const parentLeft = parentRect?.left ?? 0;
    const parentRight = parentRect?.right ?? window.innerWidth;

    let newWidth = 0;

    if (side === 'left') {
      newWidth = e.clientX - parentLeft;
    } else {
      newWidth = parentRight - e.clientX;
    }

    if (newWidth < minWidth) {
      newWidth = minWidth;
    }
    if (maxWidth && newWidth > maxWidth) {
      newWidth = maxWidth;
    }

    element.value.style.width = `${newWidth}px`;
  };

  const onMouseUp = () => {
    if (!isResizing) return;

    isResizing = false;
    document.body.classList.remove(RESIZING_CLASS);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    // Save the final width to account storage
    if (element.value && storageKey) {
      settingsStore.setAccountItem(storageKey, element.value.style.width);
    }
  };

  onMounted(() => {
    // Restore saved width on mount
    const savedWidth = storageKey ? settingsStore.getAccountItem(storageKey) : null;
    if (element.value) {
      element.value.style.width = savedWidth || `${initialWidth}px`;
    }

    if (handle.value) {
      handle.value.addEventListener('mousedown', onMouseDown);
    }
  });

  onUnmounted(() => {
    if (handle.value) {
      handle.value.removeEventListener('mousedown', onMouseDown);
    }
    // Clean up global listeners if component is unmounted while resizing
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  });
}
