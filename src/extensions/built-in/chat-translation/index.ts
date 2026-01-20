import type { ChatMessage, ExtensionAPI } from '../../../types';
import { MountableComponent } from '../../../types/ExtensionAPI';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { Translator } from './translator';
import { AutoTranslateMode, type ChatTranslationSettings } from './types';

export { manifest };

// TODO: i18n

export function activate(api: ExtensionAPI<ChatTranslationSettings>) {
  const translator = new Translator(api);
  let settingsApp: {
    unmount: () => void;
  } | null = null;

  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    settingsApp = api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  const injectSingleButton = async (messageElement: HTMLElement, messageIndex: number) => {
    const buttonsContainer = messageElement.querySelector('.message-buttons');
    if (!buttonsContainer) return;

    if (buttonsContainer.querySelector('.translation-button-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'translation-button-wrapper';
    wrapper.style.display = 'inline-flex';

    buttonsContainer.appendChild(wrapper);

    await api.ui.mountComponent(wrapper, MountableComponent.Button, {
      icon: 'fa-globe',
      title: 'Translate Message',
      variant: 'ghost',
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        translator.translateMessage(messageIndex);
      },
    });
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

  const injectInputOption = () => {
    const onClick = () => {
      translator.translateInput();
    };
    api.ui.registerChatFormOptionsMenuItem({
      id: 'chat-translation-translate-input',
      icon: 'fa-solid fa-language',
      label: 'Translate Input',
      onClick,
      visible: api.chat.getChatInfo() !== null,
    });
    api.ui.registerChatQuickAction('core.input-message', '', {
      id: 'chat-translation-translate-input',
      icon: 'fa-solid fa-language',
      label: 'Translate Input',
      onClick,
      visible: api.chat.getChatInfo() !== null,
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

  unbinds.push(
    api.events.on('chat:entered', () => {
      injectButtons();
      injectInputOption();
    }),
  );

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
  injectInputOption();

  return () => {
    settingsApp?.unmount();
    unbinds.forEach((u) => u());
    document.querySelectorAll('.translation-button-wrapper').forEach((el) => el.remove());
    api.ui.unregisterChatFormOptionsMenuItem('chat-translation-translate-input');
    api.ui.unregisterChatQuickAction('core.input-message', 'chat-translation-translate-input');
  };
}
