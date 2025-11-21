import type { ExtensionAPI } from '@/types/';
import { manifest } from './manifest';
import ClockWidget from './ClockWidget.vue';

export { manifest };

export function activate(api: ExtensionAPI) {
  let vueApp: {
    unmount: () => void;
  } | null = null;
  let container: HTMLElement | null = null;

  const mountWidget = () => {
    // Target the top of the extensions panel browser list for visibility
    const targetParent = document.querySelector('.extensions-panel-browser-header');

    if (!targetParent || container) return;

    // Create container
    container = document.createElement('div');
    container.id = 'vue-clock-extension-root';
    // Insert after the header
    targetParent.insertAdjacentElement('afterend', container);

    // Mount
    vueApp = api.ui.mount(container, ClockWidget);
  };

  // Attempt to mount immediately or wait for app load
  if (document.querySelector('.extensions-panel-browser-header')) {
    mountWidget();
  } else {
    const unbind = api.events.on('app:loaded', () => {
      mountWidget();
      unbind();
    });
  }

  return () => {
    if (vueApp) {
      vueApp.unmount();
      vueApp = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  };
}
