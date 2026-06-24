import type { ChatMessage, ExtensionAPI } from '../../../types';
import {
  fetchElevenLabsVoices,
  fetchOpenAiCompatibleVoices,
  generateElevenLabsSpeech,
  generateOpenAiCompatibleSpeech,
  generateOpenAiSpeech,
} from './requests';
import { KOKORO_DEFAULT_VOICES, mergeTtsSettings, type TextToSpeechSettings, type TtsVoice } from './types';

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

function messageCanBeNarrated(message: ChatMessage, settings: TextToSpeechSettings): boolean {
  if (message.is_system) return settings.narrateSystemMessages;
  if (message.is_user) return settings.narrateUserMessages;
  return true;
}

export class TextToSpeechService {
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private cachedVoices: TtsVoice[] = [];

  constructor(private readonly api: ExtensionAPI<TextToSpeechSettings>) {}

  getCachedVoices(): TtsVoice[] {
    return this.cachedVoices;
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }

    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }

    if (isSpeechSynthesisAvailable()) {
      window.speechSynthesis.cancel();
    }
  }

  async speakMessage(messageIndex: number): Promise<void> {
    const message = this.api.chat.getHistory()[messageIndex];
    const settings = this.getSettings();

    if (!settings.enabled || !message || !messageCanBeNarrated(message, settings)) return;

    await this.speakText(message.mes, message.name);
  }

  async speakText(text: string, speakerName?: string): Promise<void> {
    const settings = this.getSettings();
    if (!settings.enabled) return;

    const preparedText = settings.stripMarkdown ? stripMarkdown(text) : text.trim();
    if (!preparedText) return;

    if (settings.interruptPlayback) this.stop();

    if (settings.provider === 'system') {
      await this.speakWithSystemVoice(preparedText, this.resolveVoice(settings, speakerName));
      return;
    }

    const audio = await this.generateAudio(preparedText, settings, this.resolveVoice(settings, speakerName));
    await this.playBlob(audio);
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

  private async generateAudio(text: string, settings: TextToSpeechSettings, voice: string): Promise<Blob> {
    switch (settings.provider) {
      case 'openai':
        return generateOpenAiSpeech(text, {
          ...settings,
          openai: { ...settings.openai, voice },
        });
      case 'elevenlabs':
        return generateElevenLabsSpeech(text, {
          ...settings,
          elevenlabs: { ...settings.elevenlabs, voiceId: voice },
        });
      case 'kokoro-fastapi':
        return generateOpenAiCompatibleSpeech(settings.kokoro.baseUrl, text, {
          model: settings.kokoro.model,
          voice,
          responseFormat: settings.kokoro.responseFormat,
          speed: settings.kokoro.speed,
        });
      case 'openai-compatible':
        return generateOpenAiCompatibleSpeech(settings.openaiCompatible.baseUrl, text, {
          model: settings.openaiCompatible.model,
          voice,
          responseFormat: settings.openaiCompatible.responseFormat,
          speed: settings.openaiCompatible.speed,
          apiKey: settings.openaiCompatible.apiKey,
        });
      case 'system':
        throw new Error('System TTS does not generate audio blobs');
    }
  }

  private async playBlob(blob: Blob): Promise<void> {
    this.currentAudioUrl = URL.createObjectURL(blob);
    this.currentAudio = new Audio(this.currentAudioUrl);

    await new Promise<void>((resolve, reject) => {
      if (!this.currentAudio) {
        reject(new Error('Audio player was not initialized'));
        return;
      }

      this.currentAudio.onended = () => resolve();
      this.currentAudio.onerror = () => reject(new Error('Audio playback failed'));
      this.currentAudio.play().catch(reject);
    });
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
