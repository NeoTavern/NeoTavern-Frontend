import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useSettingsStore } from '../stores/settings.store';
import { isDeviceMobile as clientIsDeviceMobile, isViewportMobile as clientIsViewportMobile } from '../utils/client';

/**
 * A reactive composable to track if the viewport is mobile.
 * Updates automatically on window resize.
 */
export function useMobile() {
  const settingsStore = useSettingsStore();

  const isDeviceMobile = ref(clientIsDeviceMobile());
  const viewportMobileState = ref(clientIsViewportMobile());

  const isViewportMobile = computed(() => {
    if (settingsStore.settings.ui.forceMobileMode) {
      return true;
    }
    return viewportMobileState.value;
  });

  function handleResize() {
    const newValue = clientIsViewportMobile();
    if (viewportMobileState.value !== newValue) {
      viewportMobileState.value = newValue;
    }
  }

  onMounted(() => {
    window.addEventListener('resize', handleResize, { passive: true });
    // Check once on mount to be sure
    handleResize();
  });

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize);
  });

  return { isViewportMobile, isDeviceMobile };
}
