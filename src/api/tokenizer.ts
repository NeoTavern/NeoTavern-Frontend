import localforage from 'localforage';
import type { Tokenizer } from '../types/tokenizer';
import { TOKENIZER_GUESS_MAP, TokenizerType } from '../constants';
import { useApiStore } from '../stores/api.store';
import { useSettingsStore } from '../stores/settings.store';
import { getRequestHeaders } from '../utils/api';
import { getStringHash } from '@/utils/common';

export class TokenCacheHelper {
  static tokenizerStorage = localforage.createInstance({ name: 'SillyTavern_TokenCache' });

  static key(tokenizerType: TokenizerType, text: string): string {
    return `${tokenizerType}:${getStringHash(text)}`;
  }

  static async get(tokenizerType: TokenizerType, text: string): Promise<number | null> {
    const key = this.key(tokenizerType, text);
    const value = await this.tokenizerStorage.getItem<number>(key);
    return value ?? null;
  }

  static async set(tokenizerType: TokenizerType, text: string, tokenCount: number): Promise<void> {
    const key = this.key(tokenizerType, text);
    await this.tokenizerStorage.setItem<number>(key, tokenCount);
  }
}

export class DummyTokenizer implements Tokenizer {
  async getTokenCount(text: string): Promise<number> {
    if (!text || typeof text !== 'string') return 0;
    // This is a very rough approximation. The backend will have a proper tokenizer.
    return Math.round(text.length / 4);
  }
}

export type ApiTokenizerOptions = {
  tokenizerType: TokenizerType;
  model: string;
};

export class ApiTokenizer implements Tokenizer {
  private tokenizerType: TokenizerType;

  constructor({ tokenizerType, model }: ApiTokenizerOptions) {
    this.tokenizerType = ApiTokenizer.resolveTokenizerType(tokenizerType, model);
  }

  private static resolveTokenizerType(tokenizerType: TokenizerType, model: string): TokenizerType {
    if (tokenizerType === TokenizerType.AUTO) {
      for (const [regex, tokenizerType] of TOKENIZER_GUESS_MAP) {
        if (regex.test(model)) {
          return tokenizerType;
        }
      }
      return TokenizerType.GPT35; // Default fallback
    }

    return tokenizerType;
  }

  static get default(): Tokenizer {
    const settingsStore = useSettingsStore();
    const apiStore = useApiStore();
    return new ApiTokenizer({
      tokenizerType: settingsStore.settings.api.tokenizer,
      model: apiStore.activeModel,
    });
  }

  async getTokenCount(text: string): Promise<number> {
    if (!text || typeof text !== 'string') return 0;

    const cachedValue = await TokenCacheHelper.get(this.tokenizerType, text);
    if (typeof cachedValue === 'number') {
      return cachedValue;
    }

    const response = await fetch(`/api/tokenizers/openai/count?model=${encodeURIComponent(this.tokenizerType)}`, {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({ messages: [{ content: text }] }),
    });

    if (!response.ok) {
      throw new Error('Failed to get token count');
    }

    const data = await response.json();
    const count = data.token_count;

    await TokenCacheHelper.set(this.tokenizerType, text, count);
    return count;
  }
}
