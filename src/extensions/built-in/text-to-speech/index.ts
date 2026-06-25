import { GenerationMode } from '../../../constants';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { countTtsWords, prepareTtsText, TextToSpeechService } from './tts-service';
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

function providerSupportsEarlyStreaming(settings: TextToSpeechSettings): boolean {
  return (
    settings.streamingPlayback &&
    (settings.provider === 'kokoro-fastapi' ||
      settings.provider === 'openai-compatible' ||
      settings.provider === 'elevenlabs')
  );
}

interface EarlyPlaybackState {
  buffer: string;
  segmentQueue: string[];
  preparedQueue: Array<Promise<Awaited<ReturnType<TextToSpeechService['prepareText']>>>>;
  speakerName?: string;
  messageIndex: number | null;
  resolveMessageIndex: (messageIndex: number) => void;
  messageIndexReady: Promise<number>;
  started: boolean;
  canceled: boolean;
  finished: boolean;
  processing: boolean;
}

export function activate(api: ExtensionAPI<TextToSpeechSettings>) {
  const service = new TextToSpeechService(api);
  let settingsApp: { unmount: () => void } | null = null;
  let playbackActionCleanup: (() => void) | null = null;
  const buttonCleanupCallbacks: Array<() => void> = [];
  const earlyPlaybackByGeneration = new Map<string, EarlyPlaybackState>();

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
      const state = service.getPlaybackState();
      if (state.messageIndex === messageIndex && state.status !== 'idle') {
        cancelEarlyPlayback();
      }
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
    const onClick = () => {
      cancelEarlyPlayback();
      service.stop();
    };

    const registerPlaybackAction = (state = service.getPlaybackState()) => {
      const isActive = state.status !== 'idle';
      const isRequesting = state.status === 'requesting';
      const icon = `fa-solid ${isRequesting ? 'fa-spinner fa-spin' : isActive ? 'fa-volume-xmark' : 'fa-volume-high'}`;
      const label = isActive
        ? api.i18n.t('extensionsBuiltin.textToSpeech.stopPlayback')
        : api.i18n.t('extensionsBuiltin.textToSpeech.playback');

      api.ui.registerChatFormOptionsMenuItem({
        id: 'text-to-speech-stop',
        icon,
        label,
        onClick,
        visible: api.chat.getChatInfo() !== null,
      });

      api.ui.registerChatQuickAction('core.input-message', '', {
        id: 'text-to-speech-stop',
        icon,
        label,
        title: label,
        onClick,
        disabled: api.chat.getChatInfo() === null || !isActive,
      });
    };

    playbackActionCleanup?.();
    registerPlaybackAction();
    playbackActionCleanup = service.subscribe(registerPlaybackAction);
  };

  const unbinds: Array<() => void> = [];

  const cancelEarlyPlaybackState = (generationId: string, state: EarlyPlaybackState) => {
    state.canceled = true;
    if (state.messageIndex === null) {
      state.messageIndex = -1;
      state.resolveMessageIndex(-1);
    }
    earlyPlaybackByGeneration.delete(generationId);
  };

  const cancelEarlyPlayback = () => {
    earlyPlaybackByGeneration.forEach((state, generationId) => {
      cancelEarlyPlaybackState(generationId, state);
    });
  };

  const getSentenceBoundaryIndex = (text: string, settings: TextToSpeechSettings, minWords: number): number => {
    const preparedText = prepareTtsText(text, settings.stripMarkdown);
    if (countTtsWords(preparedText) < minWords) return -1;

    const sentenceBoundaryRegex = /[.!?…]["')\]]*(?=\s|$)/g;
    let match: RegExpExecArray | null;
    let boundaryIndex = -1;

    while ((match = sentenceBoundaryRegex.exec(text)) !== null) {
      boundaryIndex = match.index + match[0].length;
    }

    return boundaryIndex;
  };

  const prepareQueuedSegment = async (state: EarlyPlaybackState, text: string) => {
    const messageIndex = state.messageIndex ?? (await state.messageIndexReady);
    if (messageIndex === -1 || state.canceled) return null;
    return service.prepareText(text, state.speakerName, messageIndex);
  };

  const ensurePrefetch = (state: EarlyPlaybackState) => {
    while (!state.canceled && state.preparedQueue.length < 1 && state.segmentQueue.length > 0) {
      const nextSegment = state.segmentQueue.shift();
      if (!nextSegment) return;
      state.preparedQueue.push(prepareQueuedSegment(state, nextSegment));
    }
  };

  const processSpeechQueue = async (generationId: string, state: EarlyPlaybackState) => {
    if (state.processing) return;
    state.processing = true;

    try {
      ensurePrefetch(state);

      while (!state.canceled && earlyPlaybackByGeneration.has(generationId)) {
        const preparedPromise = state.preparedQueue.shift();
        if (!preparedPromise) break;

        ensurePrefetch(state);
        const prepared = await preparedPromise;
        if (state.canceled || !earlyPlaybackByGeneration.has(generationId)) break;
        if (prepared) await service.playPrepared(prepared);
        ensurePrefetch(state);
      }
    } catch (error) {
      if (state.canceled || isAbortError(error)) return;
      const message = error instanceof Error ? error.message : String(error);
      api.ui.showToast(`${api.i18n.t('extensionsBuiltin.textToSpeech.playbackFailed')}: ${message}`, 'error');
    } finally {
      state.processing = false;
      if (
        state.finished &&
        earlyPlaybackByGeneration.get(generationId) === state &&
        state.segmentQueue.length === 0 &&
        state.preparedQueue.length === 0
      ) {
        earlyPlaybackByGeneration.delete(generationId);
        return;
      }

      if (
        !state.canceled &&
        earlyPlaybackByGeneration.has(generationId) &&
        (state.segmentQueue.length > 0 || state.preparedQueue.length > 0)
      ) {
        void processSpeechQueue(generationId, state);
      }
    }
  };

  const enqueueSpeech = (generationId: string, state: EarlyPlaybackState, text: string) => {
    const speechText = text.trim();
    if (!speechText) return;

    state.started = true;
    state.segmentQueue.push(speechText);
    ensurePrefetch(state);
    void processSpeechQueue(generationId, state);
  };

  const resolveEarlyPlaybackMessageIndex = (state: EarlyPlaybackState, messageIndex: number) => {
    if (state.messageIndex !== null) return;
    state.messageIndex = messageIndex;
    state.resolveMessageIndex(messageIndex);
  };

  const flushQueuedSentences = (generationId: string, state: EarlyPlaybackState, settings: TextToSpeechSettings) => {
    while (!state.canceled) {
      const minWords = state.started ? settings.streamingStartMinWords * 3 : settings.streamingStartMinWords;
      const boundaryIndex = getSentenceBoundaryIndex(state.buffer, settings, minWords);
      if (boundaryIndex === -1) return;

      const sentence = state.buffer.slice(0, boundaryIndex);
      state.buffer = state.buffer.slice(boundaryIndex);
      enqueueSpeech(generationId, state, sentence);
    }
  };

  unbinds.push(
    api.events.on('chat:entered', () => {
      injectButtons();
      registerStopAction();
      cancelEarlyPlayback();
    }),
  );

  unbinds.push(
    api.events.on('generation:started', (context) => {
      const settings = mergeTtsSettings(api.settings.get());
      if (settings.enabled && settings.autoPlayAssistant) {
        cancelEarlyPlayback();
        if (settings.interruptPlayback) {
          service.stop();
        }
      }

      let resolveMessageIndex!: (messageIndex: number) => void;
      const messageIndexReady = new Promise<number>((resolve) => {
        resolveMessageIndex = resolve;
      });

      earlyPlaybackByGeneration.set(context.generationId, {
        buffer: '',
        segmentQueue: [],
        preparedQueue: [],
        speakerName: context.activeCharacter?.name,
        messageIndex: null,
        resolveMessageIndex,
        messageIndexReady,
        started: false,
        canceled: false,
        finished: false,
        processing: false,
      });

      if (context.mode === GenerationMode.ADD_SWIPE || context.mode === GenerationMode.CONTINUE) {
        const history = api.chat.getHistory();
        const state = earlyPlaybackByGeneration.get(context.generationId);
        if (state && history.length > 0) {
          resolveEarlyPlaybackMessageIndex(state, history.length - 1);
        }
      }
    }),
  );

  unbinds.push(
    api.events.on('generation:aborted', (context) => {
      const state = earlyPlaybackByGeneration.get(context.generationId);
      if (state) cancelEarlyPlaybackState(context.generationId, state);
    }),
  );

  unbinds.push(
    api.events.on('process:stream-chunk', (chunk, context) => {
      const settings = mergeTtsSettings(api.settings.get());
      const state = earlyPlaybackByGeneration.get(context.generationId);
      if (!state || !settings.enabled || !settings.autoPlayAssistant || !providerSupportsEarlyStreaming(settings)) {
        return;
      }

      state.buffer += chunk.delta ?? '';
      flushQueuedSentences(context.generationId, state, settings);
    }),
  );

  unbinds.push(
    api.events.on('message:created', (message: ChatMessage) => {
      const messageIndex = findMessageIndex(api.chat.getHistory(), message);
      if (messageIndex === -1) return;

      for (const state of earlyPlaybackByGeneration.values()) {
        if (state.messageIndex === null && !message.is_user && !message.is_system && !message.gen_finished) {
          resolveEarlyPlaybackMessageIndex(state, messageIndex);
          break;
        }
      }

      const messageElement = document.querySelector(`.message[data-message-index="${messageIndex}"]`);
      if (messageElement) injectSingleButton(messageElement as HTMLElement, messageIndex);
    }),
  );

  unbinds.push(
    api.events.on('generation:finished', (result: { message: ChatMessage | null; error?: Error }, context) => {
      const settings = mergeTtsSettings(api.settings.get());
      const message = result.message;
      const earlyPlayback = earlyPlaybackByGeneration.get(context.generationId);

      if (!settings.enabled || !settings.autoPlayAssistant || result.error || !isFinishedAssistantMessage(message)) {
        if (earlyPlayback) {
          cancelEarlyPlaybackState(context.generationId, earlyPlayback);
        }
        return;
      }

      const messageIndex = findMessageIndex(api.chat.getHistory(), message, context.generationId);
      if (messageIndex === -1) return;

      if (earlyPlayback?.messageIndex === null) {
        resolveEarlyPlaybackMessageIndex(earlyPlayback, messageIndex);
      }

      if (
        earlyPlayback &&
        providerSupportsEarlyStreaming(settings) &&
        (earlyPlayback.started || earlyPlayback.buffer.trim())
      ) {
        earlyPlayback.finished = true;
        if (earlyPlayback.buffer.trim()) {
          enqueueSpeech(context.generationId, earlyPlayback, earlyPlayback.buffer);
          earlyPlayback.buffer = '';
        }
        void processSpeechQueue(context.generationId, earlyPlayback);
        return;
      }

      if (earlyPlayback) earlyPlaybackByGeneration.delete(context.generationId);

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
    cancelEarlyPlayback();
    settingsApp?.unmount();
    unbinds.forEach((unbind) => unbind());
    playbackActionCleanup?.();
    buttonCleanupCallbacks.forEach((cleanup) => cleanup());
    document.querySelectorAll('.tts-button-wrapper').forEach((element) => element.remove());
    api.ui.unregisterChatFormOptionsMenuItem('text-to-speech-stop');
    api.ui.unregisterChatQuickAction('core.input-message', 'text-to-speech-stop');
    api.extensions.unregisterService(api.meta.id);
  };
}
