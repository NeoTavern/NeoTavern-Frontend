import type { ApiChatContentPart, Tokenizer } from '../types';

/**
 * A centralized utility to count tokens for message content (string or array of parts).
 * This correctly handles both simple string content and complex content with text and media.
 * @param content The content to tokenize.
 * @param tokenizer The tokenizer instance to use.
 * @returns The number of tokens in the text parts of the content.
 */
export async function countTokens(
  content: string | ApiChatContentPart[] | unknown,
  tokenizer: Tokenizer,
): Promise<number> {
  if (typeof content === 'string') {
    return await tokenizer.getTokenCount(content);
  }

  if (Array.isArray(content)) {
    // It's an array of content parts (e.g. text and images), count only text parts.
    const textContent = content
      .filter((part): part is ApiChatContentPart & { type: 'text' } => part.type === 'text')
      .map((part) => part.text || '')
      .join('');
    return await tokenizer.getTokenCount(textContent);
  }

  return 0;
}
