import { getRequestHeaders } from '../../../utils/client';
import type { TextToSpeechSettings, TtsVoice } from './types';

interface OpenAiCompatibleVoiceResponse {
  voices?: Array<string | { id?: string; name?: string; voice?: string }>;
  data?: Array<string | { id?: string; name?: string; voice?: string }>;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return text || `${response.status} ${response.statusText}`;
}

async function postJsonForAudio(url: string, body: object, headers: Record<string, string>): Promise<Blob> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.blob();
}

function mapVoiceResponse(value: unknown): TtsVoice[] {
  const data = value as OpenAiCompatibleVoiceResponse;
  const voices = data.voices ?? data.data ?? [];

  return voices
    .map((voice) => {
      if (typeof voice === 'string') return { id: voice, name: voice };
      const id = voice.id ?? voice.voice ?? voice.name;
      if (!id) return null;
      return { id, name: voice.name ?? id };
    })
    .filter((voice): voice is TtsVoice => Boolean(voice));
}

export async function generateOpenAiSpeech(text: string, settings: TextToSpeechSettings): Promise<Blob> {
  return postJsonForAudio(
    '/api/openai/generate-voice',
    {
      text,
      model: settings.openai.model,
      voice: settings.openai.voice,
      speed: settings.openai.speed,
      response_format: settings.openai.responseFormat,
    },
    getRequestHeaders(),
  );
}

export async function generateElevenLabsSpeech(text: string, settings: TextToSpeechSettings): Promise<Blob> {
  return postJsonForAudio(
    '/api/speech/elevenlabs/synthesize',
    {
      text,
      voice_id: settings.elevenlabs.voiceId,
      model_id: settings.elevenlabs.model,
      stability: settings.elevenlabs.stability,
      similarity_boost: settings.elevenlabs.similarityBoost,
    },
    getRequestHeaders(),
  );
}

export async function fetchElevenLabsVoices(): Promise<TtsVoice[]> {
  const response = await fetch('/api/speech/elevenlabs/voices', {
    method: 'POST',
    headers: getRequestHeaders(),
  });
  if (!response.ok) throw new Error(await readError(response));

  const payload = (await response.json()) as { voices?: Array<{ voice_id?: string; name?: string }> };
  return (payload.voices ?? [])
    .map((voice) => {
      if (!voice.voice_id) return null;
      return { id: voice.voice_id, name: voice.name ?? voice.voice_id };
    })
    .filter((voice): voice is TtsVoice => Boolean(voice));
}

export async function generateOpenAiCompatibleSpeech(
  baseUrl: string,
  text: string,
  options: {
    model: string;
    voice: string;
    responseFormat: string;
    speed: number;
    apiKey?: string;
  },
): Promise<Blob> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.apiKey?.trim()) {
    headers.Authorization = `Bearer ${options.apiKey.trim()}`;
  }

  return postJsonForAudio(
    joinUrl(baseUrl, 'audio/speech'),
    {
      model: options.model,
      input: text,
      voice: options.voice,
      response_format: options.responseFormat,
      speed: options.speed,
    },
    headers,
  );
}

export async function fetchOpenAiCompatibleVoices(baseUrl: string, apiKey = ''): Promise<TtsVoice[]> {
  const headers: Record<string, string> = {};
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

  const endpoints = ['audio/voices', 'voices', 'models'];
  const errors: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(joinUrl(baseUrl, endpoint), { headers });
      if (!response.ok) {
        errors.push(`${endpoint}: ${await readError(response)}`);
        continue;
      }
      const voices = mapVoiceResponse(await response.json());
      if (voices.length > 0) return voices;
    } catch (error) {
      errors.push(`${endpoint}: ${getErrorMessage(error)}`);
    }
  }

  throw new Error(errors.join('\n') || 'No voices returned');
}
