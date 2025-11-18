import type { Tokenizer } from "../types/tokenizer";
import { TOKENIZER_GUESS_MAP, TokenizerType } from "../constants";
import { useApiStore } from "../stores/api.store";
import { useSettingsStore } from "../stores/settings.store";
import { getRequestHeaders } from "../utils/api";

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
    private model: string;

    constructor({ tokenizerType, model }: ApiTokenizerOptions) {
        this.tokenizerType = tokenizerType;
        this.model = model;
    }

    private resolveTokenizerType(): TokenizerType {
        if (this.tokenizerType === TokenizerType.AUTO) {
            for (const [regex, tokenizerType] of TOKENIZER_GUESS_MAP) {
                if (regex.test(this.model)) {
                    return tokenizerType;
                }
            }
            return TokenizerType.GPT35; // Default fallback
        }

        return this.tokenizerType;
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

        const tokenizerType = this.resolveTokenizerType();
        const response = await fetch(`/api/tokenizers/openai/count?model=${encodeURIComponent(tokenizerType)}`, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ messages: [{ content: text }] }),
        });

        if (!response.ok) {
            throw new Error('Failed to get token count');
        }

        const data = await response.json();

        // TODO: Add caching of token counts based on the string hash to reduce API calls
        return data.token_count;
    }
}