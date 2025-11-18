export interface Tokenizer {
    getTokenCount(text: string): Promise<number>;
}
