import localforage from 'localforage';
import type { Tokenizer } from '../types/tokenizer';
import { TOKENIZER_GUESS_MAP, TokenizerType } from '../constants';
import { useApiStore } from '../stores/api.store';
import { useSettingsStore } from '../stores/settings.store';
import { getRequestHeaders } from '../utils/api';
import { StringHash } from '../utils/common';

export class TokenCacheHelper {
  private static readonly cacheStorage = localforage.createInstance({ name: 'SillyTavern_TokenCache' });

  static key(tokenizerType: TokenizerType, text: string): string {
    return `${tokenizerType}:${StringHash.get(text)}`;
  }

  static async get(tokenizerType: TokenizerType, text: string): Promise<number | null> {
    const key = this.key(tokenizerType, text);
    const value = await this.cacheStorage.getItem<number>(key);
    return value ?? null;
  }

  static async set(tokenizerType: TokenizerType, text: string, tokenCount: number): Promise<void> {
    const key = this.key(tokenizerType, text);
    await this.cacheStorage.setItem<number>(key, tokenCount);
  }
}

export class DummyTokenizer implements Tokenizer {
  static readonly instance = new DummyTokenizer();

  private constructor() {}

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
  private readonly tokenizerType: TokenizerType;

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

    if (this.tokenizerType === TokenizerType.NONE) {
      return DummyTokenizer.instance.getTokenCount(text);
    }

    const cachedValue = await TokenCacheHelper.get(this.tokenizerType, text);
    if (typeof cachedValue === 'number') {
      return cachedValue;
    }

    const response = await fetch(`/api/tokenizers/openai/count?model=${encodeURIComponent(this.tokenizerType)}`, {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify([{ content: text }]),
    });

    if (!response.ok) {
      console.warn(`[Tokenizer] Failed to get token count from API. Falling back to dummy tokenizer.`);
      return DummyTokenizer.instance.getTokenCount(text);
    }

    const data = await response.json();
    const count = data.token_count;

    await TokenCacheHelper.set(this.tokenizerType, text, count);
    return count;
  }
}
