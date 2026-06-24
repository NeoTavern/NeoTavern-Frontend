export type TtsProviderId = 'system' | 'openai' | 'elevenlabs' | 'kokoro-fastapi' | 'openai-compatible';

export interface TtsVoice {
  id: string;
  name: string;
  lang?: string;
}

export interface TextToSpeechSettings {
  enabled: boolean;
  provider: TtsProviderId;
  autoPlayAssistant: boolean;
  narrateUserMessages: boolean;
  narrateSystemMessages: boolean;
  stripMarkdown: boolean;
  interruptPlayback: boolean;
  characterVoices: string;
  system: {
    voice: string;
    rate: number;
    pitch: number;
  };
  openai: {
    model: string;
    voice: string;
    speed: number;
    responseFormat: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  };
  elevenlabs: {
    voiceId: string;
    model: string;
    stability: number;
    similarityBoost: number;
  };
  kokoro: {
    baseUrl: string;
    model: string;
    voice: string;
    responseFormat: 'mp3' | 'wav' | 'opus' | 'flac';
    speed: number;
    voices: string;
  };
  openaiCompatible: {
    baseUrl: string;
    apiKey: string;
    model: string;
    voice: string;
    responseFormat: 'mp3' | 'wav' | 'opus' | 'flac' | 'aac' | 'pcm';
    speed: number;
  };
}

export interface TextToSpeechExtensionService {
  speakMessage: (messageIndex: number) => Promise<void>;
  speakText: (text: string, speakerName?: string) => Promise<void>;
  stop: () => void;
  refreshVoices: () => Promise<TtsVoice[]>;
  getCachedVoices: () => TtsVoice[];
}

export const KOKORO_DEFAULT_VOICES = [
  'af_heart',
  'af_bella',
  'af_sarah',
  'af_nicole',
  'af_sky',
  'am_adam',
  'am_michael',
  'bf_emma',
  'bf_isabella',
  'bm_george',
  'bm_lewis',
];

export const DEFAULT_TTS_SETTINGS: TextToSpeechSettings = {
  enabled: true,
  provider: 'kokoro-fastapi',
  autoPlayAssistant: false,
  narrateUserMessages: false,
  narrateSystemMessages: false,
  stripMarkdown: true,
  interruptPlayback: true,
  characterVoices: '',
  system: {
    voice: '',
    rate: 1,
    pitch: 1,
  },
  openai: {
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    speed: 1,
    responseFormat: 'mp3',
  },
  elevenlabs: {
    voiceId: '',
    model: 'eleven_multilingual_v2',
    stability: 0.5,
    similarityBoost: 0.75,
  },
  kokoro: {
    baseUrl: 'http://localhost:8880/v1',
    model: 'kokoro',
    voice: 'af_heart',
    responseFormat: 'mp3',
    speed: 1,
    voices: KOKORO_DEFAULT_VOICES.join('\n'),
  },
  openaiCompatible: {
    baseUrl: 'http://localhost:8880/v1',
    apiKey: '',
    model: 'tts-1',
    voice: 'af_heart',
    responseFormat: 'mp3',
    speed: 1,
  },
};

export function mergeTtsSettings(saved: Partial<TextToSpeechSettings> | null | undefined): TextToSpeechSettings {
  return {
    ...DEFAULT_TTS_SETTINGS,
    ...saved,
    system: { ...DEFAULT_TTS_SETTINGS.system, ...saved?.system },
    openai: { ...DEFAULT_TTS_SETTINGS.openai, ...saved?.openai },
    elevenlabs: { ...DEFAULT_TTS_SETTINGS.elevenlabs, ...saved?.elevenlabs },
    kokoro: { ...DEFAULT_TTS_SETTINGS.kokoro, ...saved?.kokoro },
    openaiCompatible: { ...DEFAULT_TTS_SETTINGS.openaiCompatible, ...saved?.openaiCompatible },
  };
}
