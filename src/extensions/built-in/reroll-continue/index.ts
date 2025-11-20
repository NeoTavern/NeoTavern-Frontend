import type { ExtensionAPI, GenerationContext } from '@/types';
import { GenerationMode } from '@/constants';
import { manifest } from './manifest';
import type { RerollSnapshot } from './types';
import { type StrictT } from '@/composables/useStrictI18n';
import i18n from '@/i18n';

export { manifest };

export function activate(api: ExtensionAPI) {
  let snapshot: RerollSnapshot | null = null;
  const BUTTON_ID = 'reroll-continue-button';

  // @ts-expect-error 'i18n.global' is of type 'unknown'
  const t = i18n.global.t as StrictT;

  // Helper to toggle button visibility based on state
  const updateButtonState = () => {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;

    if (snapshot) {
      btn.style.display = 'flex';
    } else {
      btn.style.display = 'none';
    }
  };

  // 1. Capture Snapshot Logic
  const onGenerationContext = (context: GenerationContext) => {
    if (context.mode === GenerationMode.CONTINUE) {
      const history = api.chat.getHistory();
      if (history.length === 0) return;

      const index = history.length - 1;
      const lastMessage = history[index];

      snapshot = {
        messageIndex: index,
        contentBefore: lastMessage.mes,
        swipeId: lastMessage.swipe_id ?? 0,
      };

      console.debug('[Reroll Continue] Snapshot taken for message', index);
    } else if (context.mode === GenerationMode.NEW || context.mode === GenerationMode.REGENERATE) {
      // Clear snapshot to prevent jumping back to an old state after a new generation
      snapshot = null;
    }
    updateButtonState();
  };

  // 2. Reroll Action
  const rerollContinue = async () => {
    if (!snapshot) {
      api.ui.showToast(t('extensionsBuiltin.rerollContinue.noSnapshot'), 'info');
      return;
    }

    const history = api.chat.getHistory();
    // Validation
    if (history.length - 1 !== snapshot.messageIndex) {
      api.ui.showToast(t('extensionsBuiltin.rerollContinue.contextChanged'), 'warning');
      snapshot = null;
      updateButtonState();
      return;
    }

    const currentMessage = history[snapshot.messageIndex];

    // Basic safety check
    if (!currentMessage.mes.includes(snapshot.contentBefore)) {
      api.ui.showToast(t('extensionsBuiltin.rerollContinue.divergenceError'), 'warning');
      snapshot = null;
      updateButtonState();
      return;
    }

    // Check swipe consistency
    if ((currentMessage.swipe_id ?? 0) !== snapshot.swipeId) {
      api.ui.showToast(t('extensionsBuiltin.rerollContinue.swipeError'), 'warning');
      return;
    }

    api.ui.showToast(t('extensionsBuiltin.rerollContinue.reverting'), 'info');

    try {
      // Revert content
      await api.chat.updateMessageObject(snapshot.messageIndex, {
        mes: snapshot.contentBefore,
      });

      // Trigger Continue
      await api.chat.continueResponse();
    } catch (error) {
      console.error('[Reroll Continue] Failed to reroll:', error);
      api.ui.showToast(t('extensionsBuiltin.rerollContinue.error'), 'error');
    }
  };

  // 3. UI Injection
  const injectButton = () => {
    const optionsMenu = document.querySelector('.options-menu');

    // If menu doesn't exist yet (rare, but possible depending on mount timing) or button exists, skip
    if (!optionsMenu || document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('a');
    btn.id = BUTTON_ID;
    btn.className = 'options-menu-item';
    // Start hidden until we have a snapshot
    btn.style.display = 'none';
    btn.style.cursor = 'pointer';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-rotate-right';

    const span = document.createElement('span');
    span.textContent = t('extensionsBuiltin.rerollContinue.buttonLabel');

    btn.appendChild(icon);
    btn.appendChild(span);

    btn.onclick = (e) => {
      e.stopPropagation();
      // Simulate clicking the background to close the menu (handled by ChatInterface's clickOutside)
      document.body.click();
      rerollContinue();
    };

    // Insert before the <hr> if it exists, or just append
    const hr = optionsMenu.querySelector('hr');
    if (hr) {
      optionsMenu.insertBefore(btn, hr);
    } else {
      optionsMenu.appendChild(btn);
    }

    // Apply initial state
    updateButtonState();
  };

  // 4. Event Listeners
  const unbinds: Array<() => void> = [];

  unbinds.push(api.events.on('process:generation-context', onGenerationContext));

  // Clear snapshot when changing chats
  unbinds.push(
    api.events.on('chat:entered', () => {
      snapshot = null;
      updateButtonState();
    }),
  );

  // Try injection on load
  unbinds.push(api.events.on('app:loaded', injectButton));

  // Backup injection attempt
  if (document.querySelector('.options-menu')) {
    injectButton();
  }

  return () => {
    unbinds.forEach((u) => u());
    const btn = document.getElementById(BUTTON_ID);
    if (btn) btn.remove();
  };
}
