import { onMounted, onUnmounted, type Ref } from 'vue';
import { useSettingsStore } from '../stores/settings.store';
import type { AccountStorageKey } from '../types';

interface UseResizableOptions {
  storageKey?: AccountStorageKey;
  initialWidth?: number;
  minWidth?: number;
}

const RESIZING_CLASS = 'is-resizing';

export function useResizable(
  leftPane: Ref<HTMLElement | null>,
  divider: Ref<HTMLElement | null>,
  options: UseResizableOptions = {},
) {
  const { storageKey, initialWidth = 350, minWidth = 200 } = options;
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
    if (!isResizing || !leftPane.value) return;

    // Calculate new width relative to the parent container's left edge
    const parentRect = leftPane.value.parentElement?.getBoundingClientRect();
    if (!parentRect) return;

    let newWidth = e.clientX - parentRect.left;

    // Enforce minimum width
    if (newWidth < minWidth) {
      newWidth = minWidth;
    }

    leftPane.value.style.width = `${newWidth}px`;
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
    if (leftPane.value && storageKey) {
      settingsStore.setAccountItem(storageKey, leftPane.value.style.width);
    }
  };

  onMounted(() => {
    // Restore saved width on mount
    const savedWidth = storageKey ? settingsStore.getAccountItem(storageKey) : null;
    if (leftPane.value) {
      leftPane.value.style.width = savedWidth || `${initialWidth}px`;
    }

    if (divider.value) {
      divider.value.addEventListener('mousedown', onMouseDown);
    }
  });

  onUnmounted(() => {
    if (divider.value) {
      divider.value.removeEventListener('mousedown', onMouseDown);
    }
    // Clean up global listeners if component is unmounted while resizing
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  });
}
