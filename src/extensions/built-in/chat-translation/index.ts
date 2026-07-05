import type { ChatMessage, ExtensionAPI } from '../../../types';
import { MountableComponent } from '../../../types/ExtensionAPI';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { Translator } from './translator';
import { AutoTranslateMode, type ChatTranslationSettings } from './types';

export { manifest };

function isFinishedAssistantMessage(message: ChatMessage | null): message is ChatMessage {
  return Boolean(message && !message.is_user && !message.is_system && message.gen_finished);
}

function findMessageIndex(history: ChatMessage[], message: ChatMessage, generationId?: string): number {
  if (generationId) {
    for (let index = history.length - 1; index >= 0; index--) {
      const candidate = history[index];
      if (candidate.swipe_info?.some((swipe) => swipe.generation_id === generationId)) return index;
    }
  }

  const identityIndex = history.lastIndexOf(message);
  if (identityIndex !== -1) return identityIndex;

  for (let index = history.length - 1; index >= 0; index--) {
    const candidate = history[index];
    if (
      candidate.name === message.name &&
      candidate.send_date === message.send_date &&
      candidate.gen_started === message.gen_started &&
      candidate.gen_finished === message.gen_finished &&
      candidate.mes === message.mes
    ) {
      return index;
    }
  }

  return -1;
}

export function activate(api: ExtensionAPI<ChatTranslationSettings>) {
  const t = api.i18n.t;
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
      title: t('extensionsBuiltin.chatTranslation.translateMessage'),
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
      label: t('extensionsBuiltin.chatTranslation.translateInput'),
      onClick,
      visible: api.chat.getChatInfo() !== null,
    });
    api.ui.registerChatQuickAction('core.input-message', '', {
      id: 'chat-translation-translate-input',
      icon: 'fa-solid fa-language',
      label: t('extensionsBuiltin.chatTranslation.translateInput'),
      onClick,
      disabled: api.chat.getChatInfo() === null,
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

  const getMessageIndex = (message: ChatMessage, generationId?: string): number =>
    findMessageIndex(api.chat.getHistory(), message, generationId);

  const unbinds: Array<() => void> = [];

  unbinds.push(
    api.events.on('chat:entered', () => {
      injectButtons();
      injectInputOption();
    }),
  );

  // Listen for new messages for injection and user-input auto-translation.
  unbinds.push(
    api.events.on('message:created', (message: ChatMessage) => {
      const messageIndex = getMessageIndex(message);
      if (messageIndex === -1) return;
      const messageElements = document.querySelector(`.message[data-message-index="${messageIndex}"]`);
      if (messageElements) {
        injectSingleButton(messageElements as HTMLElement, messageIndex);
      } else {
        api.ui.showToast(t('extensionsBuiltin.chatTranslation.buttonInjectionFailed'), 'error');
      }

      const settings = api.settings.get();

      if (settings && message.is_user && shouldTranslate(message, settings.autoMode)) {
        translator.translateMessage(messageIndex); // fire and forget
      }
    }),
  );

  unbinds.push(
    api.events.on('generation:finished', (result: { message: ChatMessage | null; error?: Error }, context) => {
      const settings = api.settings.get();
      const message = result.message;
      if (
        !settings ||
        result.error ||
        !isFinishedAssistantMessage(message) ||
        !shouldTranslate(message, settings.autoMode)
      ) {
        return;
      }

      const messageIndex = getMessageIndex(message, context.generationId);
      if (messageIndex === -1) return;
      translator.translateMessage(messageIndex); // fire and forget
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
