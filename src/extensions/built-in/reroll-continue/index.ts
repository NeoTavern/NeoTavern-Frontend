import { GenerationMode } from '../../../constants';
import type { ApiChatMessage, ExtensionAPI, GenerationContext } from '../../../types';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { DEFAULT_IMPERSONATE_PROMPT, type ExtensionSettings, type RerollSnapshot } from './types';

export { manifest };

const DEFAULT_SETTINGS: ExtensionSettings = {
  rerollContinueEnabled: true,
  impersonateEnabled: true,
  impersonateConnectionProfile: undefined,
  impersonatePrompt: DEFAULT_IMPERSONATE_PROMPT,
};

function getSettings(api: ExtensionAPI<ExtensionSettings>): ExtensionSettings {
  return api.settings.get() ?? DEFAULT_SETTINGS;
}

export function activate(api: ExtensionAPI<ExtensionSettings>) {
  let snapshot: RerollSnapshot | null = null;
  let settingsApp: { unmount: () => void } | null = null;

  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    settingsApp = api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  const REROLL_CONTINUE_BUTTON_ID = 'reroll-continue-button';
  const IMPERSONATE_BUTTON_ID = 'impersonate-button';

  const t = api.i18n.t;

  // Helper to toggle button visibility based on state
  const updateButtonState = () => {
    const settings = getSettings(api);

    const rerollBtn = document.getElementById(REROLL_CONTINUE_BUTTON_ID);
    if (rerollBtn) {
      rerollBtn.style.display = snapshot && settings.rerollContinueEnabled ? 'flex' : 'none';
    }

    const impBtn = document.getElementById(IMPERSONATE_BUTTON_ID);
    if (impBtn) {
      impBtn.style.display = settings.impersonateEnabled ? 'flex' : 'none';
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
    const settings = getSettings(api);

    if (!settings.rerollContinueEnabled) {
      api.ui.showToast(t('extensionsBuiltin.rerollContinue.rerollDisabled'), 'info');
      return;
    }

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

  // Impersonate Action
  const impersonate = async () => {
    const settings = getSettings(api);

    if (!settings.impersonateEnabled) {
      api.ui.showToast(t('extensionsBuiltin.rerollContinue.impersonateDisabled'), 'info');
      return;
    }

    const persone = api.persona.getActive();
    if (!persone) {
      api.ui.showToast(t('extensionsBuiltin.rerollContinue.noPersona'), 'error');
      return;
    }

    let contextMessages: ApiChatMessage[] = [];
    try {
      contextMessages = await api.chat.buildPrompt();
    } catch (err) {
      console.error('[Impersonate] Failed to build prompt:', err);
      api.ui.showToast(t('extensionsBuiltin.rerollContinue.buildPromptFailed'), 'error');
      return;
    }

    const chatInputElement = document.querySelector('#chat-input') as HTMLTextAreaElement | null;
    const chatInput = chatInputElement?.value.trim() ?? '';

    const genMessages: ApiChatMessage[] = [...contextMessages];
    if (settings.impersonatePrompt) {
      const impersonateContent = api.macro.process(settings.impersonatePrompt);
      genMessages.push({
        role: 'system',
        content: impersonateContent,
        name: 'System',
      });
    }

    const newMessage: ApiChatMessage = {
      role: 'assistant',
      content: '',
      name: persone.name,
    };
    if (chatInput) {
      newMessage.content += chatInput;
    }
    genMessages.push(newMessage);

    if (!settings.impersonateConnectionProfile) {
      api.ui.showToast(t('extensionsBuiltin.rerollContinue.noConnectionProfile'), 'error');
      return;
    }

    api.ui.showToast(t('extensionsBuiltin.rerollContinue.impersonating'), 'info');

    try {
      const response = await api.llm.generate(genMessages, {
        connectionProfile: settings.impersonateConnectionProfile,
      });

      let generated = chatInput;

      if (Symbol.asyncIterator in response) {
        for await (const chunk of response) {
          generated += chunk.delta ?? '';
          if (chatInputElement) {
            chatInputElement.value = generated;
            chatInputElement.dispatchEvent(new Event('input', { bubbles: true }));
            chatInputElement.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      } else {
        generated = response.content;
        if (chatInputElement) {
          chatInputElement.value = generated;
          chatInputElement.dispatchEvent(new Event('input', { bubbles: true }));
          chatInputElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } catch (error) {
      console.error('[Impersonate] Failed:', error);
      api.ui.showToast(t('extensionsBuiltin.rerollContinue.impersonationFailed'), 'error');
    }
  };

  // 3. UI Injection
  const injectButton = () => {
    const optionsMenu = document.querySelector('.options-menu');

    // If menu doesn't exist or buttons exist, skip
    if (
      !optionsMenu ||
      document.getElementById(REROLL_CONTINUE_BUTTON_ID) ||
      document.getElementById(IMPERSONATE_BUTTON_ID)
    )
      return;

    updateButtonState(); // Pre-compute displays

    // Reroll button
    const rerollBtn = document.createElement('a');
    rerollBtn.id = REROLL_CONTINUE_BUTTON_ID;
    rerollBtn.className = 'options-menu-item';
    rerollBtn.style.cursor = 'pointer';

    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-rotate-right';

    const span = document.createElement('span');
    span.textContent = t('extensionsBuiltin.rerollContinue.buttonLabel');

    rerollBtn.appendChild(icon);
    rerollBtn.appendChild(span);

    rerollBtn.onclick = (e) => {
      e.stopPropagation();
      document.body.click();
      rerollContinue();
    };

    // Impersonate button
    const impersonateBtn = document.createElement('a');
    impersonateBtn.id = IMPERSONATE_BUTTON_ID;
    impersonateBtn.className = 'options-menu-item';
    impersonateBtn.style.cursor = 'pointer';

    const icon2 = document.createElement('i');
    icon2.className = 'fa-solid fa-user-secret';

    const span2 = document.createElement('span');
    span2.textContent = t('extensionsBuiltin.rerollContinue.impersonateButtonLabel');

    impersonateBtn.appendChild(icon2);
    impersonateBtn.appendChild(span2);

    impersonateBtn.onclick = (e) => {
      e.stopPropagation();
      document.body.click();
      impersonate();
    };

    optionsMenu.appendChild(rerollBtn);
    optionsMenu.appendChild(impersonateBtn);

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
    settingsApp?.unmount();
    unbinds.forEach((u) => u());
    const rerollBtn = document.getElementById(REROLL_CONTINUE_BUTTON_ID);
    if (rerollBtn) rerollBtn.remove();
    const impBtn = document.getElementById(IMPERSONATE_BUTTON_ID);
    if (impBtn) impBtn.remove();
  };
}
