import type { ExtensionAPI } from '../../../types/';
import ClockWidget from './ClockWidget.vue';
import { manifest } from './manifest';

export { manifest };

export function activate(api: ExtensionAPI) {
  let vueApp: {
    unmount: () => void;
  } | null = null;
  let container: HTMLElement | null = null;
  const targetSelector = '.extensions-panel-controls, .extensions-panel-browser-header';

  const mountWidget = () => {
    // Target the top of the extensions panel browser list for visibility
    const targetParent = document.querySelector(targetSelector);

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
  if (document.querySelector(targetSelector)) {
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
