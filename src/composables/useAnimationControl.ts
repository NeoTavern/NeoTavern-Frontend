import { computed, onMounted, watch } from 'vue';
import { useSettingsStore } from '../stores/settings.store';

export function useAnimationControl() {
  const settingsStore = useSettingsStore();

  const prefersReducedMotion = computed(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  const animationsDisabled = computed(() => {
    return settingsStore.settings.ui.disableAnimations || prefersReducedMotion.value;
  });

  const animationDuration = computed(() => {
    return animationsDisabled.value ? 0 : 125; // ms
  });

  // Update CSS variables when setting changes
  const updateCSSVariables = () => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    root.style.setProperty('--animation-duration', `${animationDuration.value}ms`);
    root.style.setProperty('--animation-duration-2x', `${animationDuration.value * 2}ms`);
    root.style.setProperty('--animation-duration-3x', `${animationDuration.value * 3}ms`);

    // Add/remove animations-disabled class to root
    if (animationsDisabled.value) {
      root.classList.add('animations-disabled');
    } else {
      root.classList.remove('animations-disabled');
    }
  };

  // Initialize CSS variables
  onMounted(() => {
    updateCSSVariables();
  });

  // Watch for changes and update CSS variables
  watch([animationsDisabled, animationDuration], () => {
    updateCSSVariables();
  });

  // Watch for system preference changes
  onMounted(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => {
      updateCSSVariables();
    };

    mediaQuery.addEventListener('change', handler);

    // Clean up on unmount
    return () => {
      mediaQuery.removeEventListener('change', handler);
    };
  });

  return {
    animationDuration,
    animationsDisabled,
    prefersReducedMotion,
  };
}
