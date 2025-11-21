import type { ExtensionAPI } from '@/types';
import { manifest } from './manifest';
import { MountableComponent } from '@/types/ExtensionAPI';

export { manifest };

export function activate(api: ExtensionAPI) {
  const { ui, settings, meta } = api;

  // Constants
  const TARGET_SELECTOR = '#main-content';
  const HIGHLIGHT_CLASS = 'vanilla-logger-highlight';
  const STYLE_ID = 'vanilla-logger-style';
  const SETTING_KEY = 'isHighVisibility';

  // 1. Inject Global Styles (CSS for the highlight effect)
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        border: 4px dashed var(--color-accent-red);
        box-shadow: inset 0 0 50px var(--color-accent-crimson-70a);
        transition: all 0.3s ease;
      }
      .vanilla-controls {
        padding: 10px;
        background: var(--black-30a);
        border-radius: 5px;
        margin-top: 10px;
        border: 1px solid var(--theme-border-color);
      }
    `;
    document.head.appendChild(style);
  }

  // 2. Helper to toggle the DOM effect
  const setEffect = (enabled: boolean) => {
    const el = document.querySelector(TARGET_SELECTOR);
    if (el) {
      if (enabled) {
        el.classList.add(HIGHLIGHT_CLASS);
      } else {
        el.classList.remove(HIGHLIGHT_CLASS);
      }
    }
  };

  // 3. Build the Settings UI inside the extension drawer using MountableComponent
  const container = document.getElementById(meta.containerId);

  if (container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'vanilla-controls';
    container.appendChild(wrapper);

    // Load Saved State (default to false)
    const savedState = settings.get(SETTING_KEY) ?? false;
    setEffect(savedState);

    api.ui.mountComponent(wrapper, MountableComponent.AppCheckbox, {
      label: 'Enable High Visibility Mode',
      description: 'Highlights the chat area with a red border.',
      modelValue: savedState,
      'onUpdate:modelValue': (isChecked: boolean) => {
        setEffect(isChecked);
        settings.set(SETTING_KEY, isChecked);
        ui.showToast(isChecked ? 'Highlight Enabled' : 'Highlight Disabled');
      },
    });
  }

  // 4. Return Cleanup Function
  return () => {
    // Remove effect
    setEffect(false);

    // Remove global styles
    const style = document.getElementById(STYLE_ID);
    if (style) {
      style.remove();
    }
    if (document.getElementById(meta.containerId)) {
      document.getElementById(meta.containerId)!.innerHTML = '';
    }
  };
}
