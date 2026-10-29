import type { GenerationResponse, StreamedChunk } from '../../../../types';

/**
 * Returns the full text of an LLM response, reading the stream when there is one.
 * `onText` receives the accumulated text after each chunk; `shouldStop` is checked before each chunk.
 */
export async function collectResponseText(
  response: GenerationResponse | AsyncGenerator<StreamedChunk>,
  options: { prefix?: string; onText?: (text: string) => void; shouldStop?: () => boolean } = {},
): Promise<string> {
  let text = options.prefix ?? '';
  if (!(Symbol.asyncIterator in response)) {
    text += response.content;
    options.onText?.(text);
    return text;
  }
  for await (const chunk of response) {
    if (options.shouldStop?.()) break;
    text += chunk.delta ?? '';
    options.onText?.(text);
  }
  return text;
}

/** Returns the trimmed contents of the first fenced code block, or the trimmed text when there is none. */
export function extractCodeBlock(text: string): string {
  const match = text.match(/```(?:[\w]*\n)?([\s\S]*?)```/i);
  return match?.[1] ? match[1].trim() : text.trim();
}
