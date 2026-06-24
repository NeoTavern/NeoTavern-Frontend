import type { ChatMessage, ExtensionAPI } from '../../../types';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { TextToSpeechService } from './tts-service';
import { mergeTtsSettings, type TextToSpeechSettings, type TtsPlaybackState } from './types';

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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function activate(api: ExtensionAPI<TextToSpeechSettings>) {
  const service = new TextToSpeechService(api);
  let settingsApp: { unmount: () => void } | null = null;
  const buttonCleanupCallbacks: Array<() => void> = [];

  api.settings.set(undefined, mergeTtsSettings(api.settings.get()));
  api.settings.save();
  api.extensions.registerService(api.meta.id, service);

  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    settingsApp = api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  const renderButton = (
    button: HTMLButtonElement,
    icon: HTMLElement,
    messageIndex: number,
    state: TtsPlaybackState,
  ) => {
    const isActive = state.messageIndex === messageIndex && state.status !== 'idle';
    const isRequesting = isActive && state.status === 'requesting';

    button.classList.toggle('active', isActive);
    button.disabled = false;
    button.title = isActive
      ? api.i18n.t('extensionsBuiltin.textToSpeech.stopPlayback')
      : api.i18n.t('extensionsBuiltin.textToSpeech.speakMessage');
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');

    icon.className = `fa-solid ${isRequesting ? 'fa-spinner fa-spin' : isActive ? 'fa-volume-xmark' : 'fa-volume-high'}`;
  };

  const injectSingleButton = (messageElement: HTMLElement, messageIndex: number) => {
    const buttonsContainer = messageElement.querySelector('.message-buttons');
    if (!buttonsContainer) return;
    if (buttonsContainer.querySelector('.tts-button-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'tts-button-wrapper';
    wrapper.style.display = 'inline-flex';
    buttonsContainer.appendChild(wrapper);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-button menu-button--ghost';
    button.setAttribute('aria-pressed', 'false');

    const icon = document.createElement('i');
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    wrapper.appendChild(button);

    const unsubscribe = service.subscribe((state) => {
      renderButton(button, icon, messageIndex, state);
    });
    buttonCleanupCallbacks.push(unsubscribe);

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      service.toggleMessage(messageIndex).catch((error: unknown) => {
        if (isAbortError(error)) return;
        const message = error instanceof Error ? error.message : String(error);
        api.ui.showToast(`${api.i18n.t('extensionsBuiltin.textToSpeech.playbackFailed')}: ${message}`, 'error');
      });
    });
  };

  const injectButtons = () => {
    document.querySelectorAll('.message').forEach((element) => {
      const indexAttr = element.getAttribute('data-message-index');
      if (indexAttr === null) return;
      const messageIndex = parseInt(indexAttr, 10);
      if (Number.isNaN(messageIndex)) return;
      injectSingleButton(element as HTMLElement, messageIndex);
    });
  };

  const registerStopAction = () => {
    const onClick = () => service.stop();

    api.ui.registerChatFormOptionsMenuItem({
      id: 'text-to-speech-stop',
      icon: 'fa-solid fa-volume-xmark',
      label: api.i18n.t('extensionsBuiltin.textToSpeech.stopPlayback'),
      onClick,
      visible: api.chat.getChatInfo() !== null,
    });

    api.ui.registerChatQuickAction('core.input-message', '', {
      id: 'text-to-speech-stop',
      icon: 'fa-solid fa-volume-xmark',
      label: api.i18n.t('extensionsBuiltin.textToSpeech.stopPlayback'),
      onClick,
      disabled: api.chat.getChatInfo() === null,
    });
  };

  const unbinds: Array<() => void> = [];

  unbinds.push(
    api.events.on('chat:entered', () => {
      injectButtons();
      registerStopAction();
    }),
  );

  unbinds.push(
    api.events.on('message:created', (message: ChatMessage) => {
      const messageIndex = findMessageIndex(api.chat.getHistory(), message);
      if (messageIndex === -1) return;

      const messageElement = document.querySelector(`.message[data-message-index="${messageIndex}"]`);
      if (messageElement) injectSingleButton(messageElement as HTMLElement, messageIndex);
    }),
  );

  unbinds.push(
    api.events.on('generation:finished', (result: { message: ChatMessage | null; error?: Error }, context) => {
      const settings = mergeTtsSettings(api.settings.get());
      const message = result.message;

      if (!settings.enabled || !settings.autoPlayAssistant || result.error || !isFinishedAssistantMessage(message)) {
        return;
      }

      const messageIndex = findMessageIndex(api.chat.getHistory(), message, context.generationId);
      if (messageIndex === -1) return;

      service.speakMessage(messageIndex).catch((error: unknown) => {
        if (isAbortError(error)) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        api.ui.showToast(`${api.i18n.t('extensionsBuiltin.textToSpeech.playbackFailed')}: ${errorMessage}`, 'error');
      });
    }),
  );

  injectButtons();
  registerStopAction();

  return () => {
    service.stop();
    settingsApp?.unmount();
    unbinds.forEach((unbind) => unbind());
    buttonCleanupCallbacks.forEach((cleanup) => cleanup());
    document.querySelectorAll('.tts-button-wrapper').forEach((element) => element.remove());
    api.ui.unregisterChatFormOptionsMenuItem('text-to-speech-stop');
    api.ui.unregisterChatQuickAction('core.input-message', 'text-to-speech-stop');
    api.extensions.unregisterService(api.meta.id);
  };
}
