import { GenerationMode } from '../../../constants';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import { findChatMessageIndex, isFinishedAssistantMessage } from '../_shared/runtime/chat-message';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import TtsMessageButton from './TtsMessageButton.vue';
import { countTtsWords, prepareTtsText, TextToSpeechService } from './tts-service';
import { mergeTtsSettings, type TextToSpeechSettings } from './types';

export { manifest };

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
  let playbackActionCleanup: (() => void) | null = null;
  const earlyPlaybackByGeneration = new Map<string, EarlyPlaybackState>();

  api.settings.set(undefined, mergeTtsSettings(api.settings.get()));
  api.settings.save();
  api.extensions.registerService(api.meta.id, service);

  api.ui.registerSettingsPanel(SettingsPanel, { api });

  api.ui.registerMessageButton({
    id: 'text-to-speech.speak',
    component: TtsMessageButton,
    props: {
      api,
      service,
      onToggle: (messageIndex: number) => {
        const state = service.getPlaybackState();
        if (state.messageIndex === messageIndex && state.status !== 'idle') {
          cancelEarlyPlayback();
        }
        service.toggleMessage(messageIndex).catch((error: unknown) => {
          if (isAbortError(error)) return;
          const message = error instanceof Error ? error.message : String(error);
          api.ui.showToast(`${api.i18n.t('extensionsBuiltin.textToSpeech.playbackFailed')}: ${message}`, 'error');
        });
      },
    },
  });

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
      if (!state.canceled && !isAbortError(error)) {
        const message = error instanceof Error ? error.message : String(error);
        api.ui.showToast(`${api.i18n.t('extensionsBuiltin.textToSpeech.playbackFailed')}: ${message}`, 'error');
      }
    } finally {
      state.processing = false;
      if (
        state.finished &&
        earlyPlaybackByGeneration.get(generationId) === state &&
        state.segmentQueue.length === 0 &&
        state.preparedQueue.length === 0
      ) {
        earlyPlaybackByGeneration.delete(generationId);
      } else if (
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

  api.events.on('chat:entered', () => {
    registerStopAction();
    cancelEarlyPlayback();
  });

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
  });

  api.events.on('generation:aborted', (context) => {
    const state = earlyPlaybackByGeneration.get(context.generationId);
    if (state) cancelEarlyPlaybackState(context.generationId, state);
  });

  api.events.on('process:stream-chunk', (chunk, context) => {
    const settings = mergeTtsSettings(api.settings.get());
    const state = earlyPlaybackByGeneration.get(context.generationId);
    if (!state || !settings.enabled || !settings.autoPlayAssistant || !providerSupportsEarlyStreaming(settings)) {
      return;
    }

    state.buffer += chunk.delta ?? '';
    flushQueuedSentences(context.generationId, state, settings);
  });

  api.events.on('message:created', (message: ChatMessage) => {
    const messageIndex = findChatMessageIndex(api.chat.getHistory(), message);
    if (messageIndex === -1) return;

    for (const state of earlyPlaybackByGeneration.values()) {
      if (state.messageIndex === null && !message.is_user && !message.is_system && !message.gen_finished) {
        resolveEarlyPlaybackMessageIndex(state, messageIndex);
        break;
      }
    }
  });

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

    const messageIndex = findChatMessageIndex(api.chat.getHistory(), message, context.generationId);
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
  });

  registerStopAction();

  return () => {
    service.stop();
    cancelEarlyPlayback();
    playbackActionCleanup?.();
  };
}
