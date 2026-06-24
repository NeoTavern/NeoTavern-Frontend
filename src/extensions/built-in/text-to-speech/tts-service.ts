import type { ExtensionAPI } from '../../../types';
import {
  fetchElevenLabsVoices,
  fetchOpenAiCompatibleVoices,
  generateElevenLabsSpeech,
  generateOpenAiCompatibleSpeech,
  generateOpenAiSpeech,
  streamElevenLabsSpeech,
  streamOpenAiCompatibleSpeech,
} from './requests';
import {
  KOKORO_DEFAULT_VOICES,
  mergeTtsSettings,
  type TextToSpeechSettings,
  type TtsPlaybackState,
  type TtsVoice,
} from './types';

function isSpeechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_~>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCharacterVoices(value: string): Record<string, string> {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) return acc;

      const character = line.slice(0, separatorIndex).trim().toLowerCase();
      const voice = line.slice(separatorIndex + 1).trim();
      if (character && voice) acc[character] = voice;
      return acc;
    }, {});
}

function parseVoiceList(value: string): TtsVoice[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((voice) => ({ id: voice, name: voice }));
}

export class TextToSpeechService {
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private currentAbortController: AbortController | null = null;
  private currentAudioContext: AudioContext | null = null;
  private stopRequested = false;
  private cachedVoices: TtsVoice[] = [];
  private state: TtsPlaybackState = { status: 'idle', messageIndex: null };
  private listeners = new Set<(state: TtsPlaybackState) => void>();

  constructor(private readonly api: ExtensionAPI<TextToSpeechSettings>) {}

  getCachedVoices(): TtsVoice[] {
    return this.cachedVoices;
  }

  getPlaybackState(): TtsPlaybackState {
    return { ...this.state };
  }

  subscribe(listener: (state: TtsPlaybackState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getPlaybackState());
    return () => this.listeners.delete(listener);
  }

  stop(): void {
    this.stopRequested = true;
    this.currentAbortController?.abort();
    this.currentAbortController = null;

    if (this.currentAudio) {
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }

    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }

    void this.currentAudioContext?.close();
    this.currentAudioContext = null;

    if (isSpeechSynthesisAvailable()) {
      window.speechSynthesis.cancel();
    }

    this.setState({ status: 'idle', messageIndex: null });
  }

  async toggleMessage(messageIndex: number): Promise<void> {
    const state = this.getPlaybackState();
    if (state.messageIndex === messageIndex && state.status !== 'idle') {
      this.stop();
      return;
    }

    await this.speakMessage(messageIndex);
  }

  async speakMessage(messageIndex: number): Promise<void> {
    const message = this.api.chat.getHistory()[messageIndex];
    const settings = this.getSettings();

    if (!settings.enabled || !message) return;

    await this.speakText(message.mes, message.name, messageIndex);
  }

  async speakText(text: string, speakerName?: string, messageIndex: number | null = null): Promise<void> {
    const settings = this.getSettings();
    if (!settings.enabled) return;

    const preparedText = settings.stripMarkdown ? stripMarkdown(text) : text.trim();
    if (!preparedText) return;

    if (settings.interruptPlayback) this.stop();
    this.stopRequested = false;

    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    try {
      if (settings.provider === 'system') {
        this.setState({ status: 'playing', messageIndex });
        await this.speakWithSystemVoice(preparedText, this.resolveVoice(settings, speakerName));
        return;
      }

      this.setState({ status: 'requesting', messageIndex });
      const voice = this.resolveVoice(settings, speakerName);

      if (this.shouldStream(settings)) {
        const stream = await this.generateAudioStream(preparedText, settings, voice, signal);
        if (signal.aborted) return;

        this.setState({ status: 'playing', messageIndex });
        await this.playStream(stream, settings, signal);
        return;
      }

      const audio = await this.generateAudio(preparedText, settings, voice, signal);
      if (signal.aborted) return;

      this.setState({ status: 'playing', messageIndex });
      await this.playBlob(audio);
    } finally {
      if (this.currentAbortController?.signal === signal) {
        this.currentAbortController = null;
      }
      if (this.state.messageIndex === messageIndex) {
        this.setState({ status: 'idle', messageIndex: null });
      }
    }
  }

  async refreshVoices(): Promise<TtsVoice[]> {
    const settings = this.getSettings();

    if (settings.provider === 'system') {
      this.cachedVoices = await this.getSystemVoices();
      return this.cachedVoices;
    }

    if (settings.provider === 'kokoro-fastapi') {
      try {
        this.cachedVoices = await fetchOpenAiCompatibleVoices(settings.kokoro.baseUrl);
      } catch {
        this.cachedVoices = parseVoiceList(settings.kokoro.voices || KOKORO_DEFAULT_VOICES.join('\n'));
      }
      return this.cachedVoices;
    }

    if (settings.provider === 'openai-compatible') {
      this.cachedVoices = await fetchOpenAiCompatibleVoices(
        settings.openaiCompatible.baseUrl,
        settings.openaiCompatible.apiKey,
      );
      return this.cachedVoices;
    }

    if (settings.provider === 'elevenlabs') {
      this.cachedVoices = await fetchElevenLabsVoices();
      return this.cachedVoices;
    }

    this.cachedVoices = [
      { id: 'alloy', name: 'alloy' },
      { id: 'ash', name: 'ash' },
      { id: 'ballad', name: 'ballad' },
      { id: 'coral', name: 'coral' },
      { id: 'echo', name: 'echo' },
      { id: 'fable', name: 'fable' },
      { id: 'nova', name: 'nova' },
      { id: 'onyx', name: 'onyx' },
      { id: 'sage', name: 'sage' },
      { id: 'shimmer', name: 'shimmer' },
    ];
    return this.cachedVoices;
  }

  private getSettings(): TextToSpeechSettings {
    return mergeTtsSettings(this.api.settings.get());
  }

  private resolveVoice(settings: TextToSpeechSettings, speakerName?: string): string {
    const characterVoice = speakerName
      ? parseCharacterVoices(settings.characterVoices)[speakerName.toLowerCase()]
      : undefined;
    if (characterVoice) return characterVoice;

    switch (settings.provider) {
      case 'system':
        return settings.system.voice;
      case 'openai':
        return settings.openai.voice;
      case 'elevenlabs':
        return settings.elevenlabs.voiceId;
      case 'kokoro-fastapi':
        return settings.kokoro.voice;
      case 'openai-compatible':
        return settings.openaiCompatible.voice;
    }
  }

  private async generateAudio(
    text: string,
    settings: TextToSpeechSettings,
    voice: string,
    signal: AbortSignal,
  ): Promise<Blob> {
    switch (settings.provider) {
      case 'openai':
        return generateOpenAiSpeech(
          text,
          {
            ...settings,
            openai: { ...settings.openai, voice },
          },
          signal,
        );
      case 'elevenlabs':
        return generateElevenLabsSpeech(
          text,
          {
            ...settings,
            elevenlabs: { ...settings.elevenlabs, voiceId: voice },
          },
          signal,
        );
      case 'kokoro-fastapi':
        return generateOpenAiCompatibleSpeech(
          settings.kokoro.baseUrl,
          text,
          {
            model: settings.kokoro.model,
            voice,
            responseFormat: settings.kokoro.responseFormat,
            speed: settings.kokoro.speed,
          },
          signal,
        );
      case 'openai-compatible':
        return generateOpenAiCompatibleSpeech(
          settings.openaiCompatible.baseUrl,
          text,
          {
            model: settings.openaiCompatible.model,
            voice,
            responseFormat: settings.openaiCompatible.responseFormat,
            speed: settings.openaiCompatible.speed,
            apiKey: settings.openaiCompatible.apiKey,
          },
          signal,
        );
      case 'system':
        throw new Error('System TTS does not generate audio blobs');
    }
  }

  private async generateAudioStream(
    text: string,
    settings: TextToSpeechSettings,
    voice: string,
    signal: AbortSignal,
  ): Promise<Response> {
    switch (settings.provider) {
      case 'elevenlabs':
        return streamElevenLabsSpeech(
          text,
          {
            ...settings,
            elevenlabs: { ...settings.elevenlabs, voiceId: voice },
          },
          signal,
        );
      case 'kokoro-fastapi':
        return streamOpenAiCompatibleSpeech(
          settings.kokoro.baseUrl,
          text,
          {
            model: settings.kokoro.model,
            voice,
            responseFormat: 'pcm',
            speed: settings.kokoro.speed,
          },
          signal,
        );
      case 'openai-compatible':
        return streamOpenAiCompatibleSpeech(
          settings.openaiCompatible.baseUrl,
          text,
          {
            model: settings.openaiCompatible.model,
            voice,
            responseFormat: 'pcm',
            speed: settings.openaiCompatible.speed,
            apiKey: settings.openaiCompatible.apiKey,
          },
          signal,
        );
      case 'openai':
      case 'system':
        throw new Error('Streaming is not supported for this provider');
    }
  }

  private async playBlob(blob: Blob): Promise<void> {
    this.stopRequested = false;
    this.currentAudioUrl = URL.createObjectURL(blob);
    this.currentAudio = new Audio(this.currentAudioUrl);

    await new Promise<void>((resolve, reject) => {
      if (!this.currentAudio) {
        reject(new Error('Audio player was not initialized'));
        return;
      }

      this.currentAudio.onended = () => resolve();
      this.currentAudio.onerror = () => {
        if (this.stopRequested) {
          resolve();
          return;
        }
        reject(new Error('Audio playback failed'));
      };
      this.currentAudio.play().catch(reject);
    });
  }

  private async playStream(response: Response, settings: TextToSpeechSettings, signal: AbortSignal): Promise<void> {
    if (settings.provider === 'kokoro-fastapi' || settings.provider === 'openai-compatible') {
      await this.playPcmStream(response, signal);
      return;
    }

    await this.playMediaSourceStream(response, signal);
  }

  private async playPcmStream(response: Response, signal: AbortSignal): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      await this.playBlob(await response.blob());
      return;
    }

    const audioContext = new AudioContext({ sampleRate: 24000 });
    this.currentAudioContext = audioContext;
    let nextStartTime = audioContext.currentTime + 0.05;
    let pending = new Uint8Array(0);

    const scheduleChunk = (bytes: Uint8Array) => {
      const sampleCount = Math.floor(bytes.byteLength / 2);
      if (sampleCount === 0) return;

      const audioBuffer = audioContext.createBuffer(1, sampleCount, audioContext.sampleRate);
      const channel = audioBuffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
      for (let index = 0; index < sampleCount; index++) {
        channel[index] = view.getInt16(index * 2, true) / 32768;
      }

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);

      const startTime = Math.max(nextStartTime, audioContext.currentTime + 0.02);
      source.start(startTime);
      nextStartTime = startTime + audioBuffer.duration;
    };

    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const merged = new Uint8Array(pending.byteLength + value.byteLength);
      merged.set(pending, 0);
      merged.set(value, pending.byteLength);

      const playableLength = merged.byteLength - (merged.byteLength % 2);
      scheduleChunk(merged.slice(0, playableLength));
      pending = merged.slice(playableLength);
    }

    if (signal.aborted || this.stopRequested) return;

    const remainingMs = Math.max(0, (nextStartTime - audioContext.currentTime) * 1000);
    await new Promise((resolve) => window.setTimeout(resolve, remainingMs));
  }

  private async playMediaSourceStream(response: Response, signal: AbortSignal): Promise<void> {
    const contentType = response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
    const mediaSourceType = contentType === 'audio/mpeg' ? 'audio/mpeg' : contentType;

    if (!response.body || typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mediaSourceType)) {
      await this.playBlob(await response.blob());
      return;
    }

    const mediaSource = new MediaSource();
    this.currentAudioUrl = URL.createObjectURL(mediaSource);
    this.currentAudio = new Audio(this.currentAudioUrl);

    await new Promise<void>((resolve, reject) => {
      if (!this.currentAudio) {
        reject(new Error('Audio player was not initialized'));
        return;
      }

      const appendChunk = (sourceBuffer: SourceBuffer, chunk: Uint8Array) =>
        new Promise<void>((appendResolve, appendReject) => {
          const cleanup = () => {
            sourceBuffer.removeEventListener('updateend', onUpdateEnd);
            sourceBuffer.removeEventListener('error', onError);
          };
          const onUpdateEnd = () => {
            cleanup();
            appendResolve();
          };
          const onError = () => {
            cleanup();
            appendReject(new Error('Streaming audio append failed'));
          };

          sourceBuffer.addEventListener('updateend', onUpdateEnd);
          sourceBuffer.addEventListener('error', onError);
          const buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
          sourceBuffer.appendBuffer(buffer);
        });

      mediaSource.addEventListener(
        'sourceopen',
        () => {
          const sourceBuffer = mediaSource.addSourceBuffer(mediaSourceType);
          const reader = response.body?.getReader();
          if (!reader) {
            reject(new Error('Audio stream reader was not initialized'));
            return;
          }

          this.currentAudio?.play().catch(reject);

          void (async () => {
            try {
              while (!signal.aborted) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!value) continue;
                await appendChunk(sourceBuffer, value);
              }

              if (mediaSource.readyState === 'open') mediaSource.endOfStream();
            } catch (error) {
              if (signal.aborted || this.stopRequested) return;
              reject(error);
            }
          })();
        },
        { once: true },
      );

      this.currentAudio.onended = () => resolve();
      this.currentAudio.onerror = () => {
        if (this.stopRequested) {
          resolve();
          return;
        }
        reject(new Error('Streaming audio playback failed'));
      };
    });
  }

  private shouldStream(settings: TextToSpeechSettings): boolean {
    return (
      settings.streamingPlayback &&
      (settings.provider === 'kokoro-fastapi' ||
        settings.provider === 'openai-compatible' ||
        settings.provider === 'elevenlabs')
    );
  }

  private setState(state: TtsPlaybackState): void {
    this.state = state;
    const snapshot = this.getPlaybackState();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private async speakWithSystemVoice(text: string, voiceName: string): Promise<void> {
    if (!isSpeechSynthesisAvailable()) {
      throw new Error('Speech synthesis is not available in this browser');
    }

    const settings = this.getSettings();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = settings.system.rate;
    utterance.pitch = settings.system.pitch;

    const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.name === voiceName);
    if (voice) utterance.voice = voice;

    await new Promise<void>((resolve, reject) => {
      utterance.onend = () => resolve();
      utterance.onerror = (event) => reject(new Error(event.error));
      window.speechSynthesis.speak(utterance);
    });
  }

  private async getSystemVoices(): Promise<TtsVoice[]> {
    if (!isSpeechSynthesisAvailable()) return [];

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      return voices.map((voice) => ({ id: voice.name, name: voice.name, lang: voice.lang }));
    }

    return new Promise((resolve) => {
      window.speechSynthesis.onvoiceschanged = () => {
        resolve(
          window.speechSynthesis.getVoices().map((voice) => ({ id: voice.name, name: voice.name, lang: voice.lang })),
        );
      };
    });
  }
}
