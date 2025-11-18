import type { ExtensionAPI } from '@/types';
import { manifest } from './manifest';

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
      /* Styles for our vanilla UI panel */
      .vanilla-controls {
        padding: 10px;
        background: var(--black-30a);
        border-radius: 5px;
        margin-top: 10px;
        border: 1px solid var(--theme-border-color);
      }
      .vanilla-controls h4 {
        margin: 0 0 10px 0;
        font-size: 0.9rem;
        opacity: 0.8;
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

  // 3. Build the Settings UI inside the extension drawer
  // We use the container provided by the system for this specific extension
  const container = document.getElementById(meta.containerId);

  if (container) {
    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'vanilla-controls';

    const title = document.createElement('h4');
    title.textContent = 'Vanilla Settings';
    wrapper.appendChild(title);

    // Create Checkbox Label
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.cursor = 'pointer';
    label.style.gap = '10px';

    // Create Input
    const input = document.createElement('input');
    input.type = 'checkbox';

    // Load Saved State (default to false)
    const savedState = settings.get(SETTING_KEY) ?? false;
    input.checked = savedState;

    // Apply initial state
    setEffect(savedState);

    // Add Event Listener
    input.onchange = () => {
      const isChecked = input.checked;
      setEffect(isChecked);

      // Save setting
      settings.set(SETTING_KEY, isChecked);

      ui.showToast(isChecked ? 'Highlight Enabled' : 'Highlight Disabled');
    };

    const span = document.createElement('span');
    span.textContent = 'Enable High Visibility Mode';

    // Assemble
    label.appendChild(input);
    label.appendChild(span);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
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
    document.getElementById(meta.containerId)!.innerHTML = '';
  };
}
