import type { ExtensionAPI, ChatMessage } from '@/types';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { Translator } from './translator';
import { AutoTranslateMode, type ChatTranslationSettings } from './types';

export { manifest };

export function activate(api: ExtensionAPI<ChatTranslationSettings>) {
  const translator = new Translator(api);
  let settingsApp: {
    unmount: () => void;
  } | null = null;

  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    settingsApp = api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  const injectSingleButton = (messageElement: HTMLElement, messageIndex: number) => {
    const buttonsContainer = messageElement.querySelector('.message-buttons');
    if (!buttonsContainer) return;

    if (buttonsContainer.querySelector('.translation-button')) return;

    const btn = document.createElement('i');
    btn.className = 'message-button fa-solid fa-globe translation-button';
    btn.title = 'Translate Message';
    btn.style.cursor = 'pointer';

    btn.onclick = (e) => {
      e.stopPropagation();
      translator.translateMessage(messageIndex);
    };

    buttonsContainer.appendChild(btn);
  };

  const injectButtons = () => {
    const messageElements = document.querySelectorAll('.message');

    messageElements.forEach((el) => {
      const indexAttr = el.getAttribute('data-message-index');
      if (indexAttr === null) return;
      const messageIndex = parseInt(indexAttr, 10);
      if (isNaN(messageIndex)) return;
      injectSingleButton(el as HTMLElement, messageIndex);
    });
  };

  const shouldTranslate = (message: ChatMessage, autoMode: AutoTranslateMode): boolean => {
    const isSystem = message.is_system;
    const isUser = message.is_user;

    switch (autoMode) {
      case AutoTranslateMode.RESPONSES:
        return !isSystem && !isUser;
      case AutoTranslateMode.INPUTS:
        return !isSystem && !!isUser;
      case AutoTranslateMode.BOTH:
        return !isSystem;
      default:
        return false;
    }
  };

  const unbinds: Array<() => void> = [];

  unbinds.push(api.events.on('chat:entered', injectButtons));

  // Listen for new messages for Injection AND Auto-Translation
  unbinds.push(
    api.events.on('message:created', (message: ChatMessage) => {
      const messageIndex = api.chat.getHistory().length - 1;
      const messageElements = document.querySelector(`.message[data-message-index="${messageIndex}"]`);
      if (messageElements) {
        injectSingleButton(messageElements as HTMLElement, messageIndex);
      } else {
        api.ui.showToast('Translation button injection failed: Message element not found', 'error');
      }

      const settings = api.settings.get();

      if (settings && shouldTranslate(message, settings.autoMode)) {
        translator.translateMessage(messageIndex); // fire and forget
      }
    }),
  );

  // Initial Injection
  injectButtons();

  return () => {
    settingsApp?.unmount();
    unbinds.forEach((u) => u());
    // Remove buttons
    document.querySelectorAll('.translation-button').forEach((el) => el.remove());
  };
}
