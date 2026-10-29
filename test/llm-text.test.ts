import { describe, expect, it } from 'vitest';
import { collectResponseText, extractCodeBlock } from '../src/extensions/built-in/_shared/runtime/llm-text';
import type { StreamedChunk } from '../src/types';

async function* stream(...deltas: string[]): AsyncGenerator<StreamedChunk> {
  for (const delta of deltas) yield { delta };
}

describe('collectResponseText', () => {
  it('joins streamed deltas after the prefix and reports progress', async () => {
    const seen: string[] = [];
    const text = await collectResponseText(stream('lo', ' world'), { prefix: 'Hel', onText: (t) => seen.push(t) });

    expect(text).toBe('Hello world');
    expect(seen).toEqual(['Hello', 'Hello world']);
  });

  it('stops before reading the next chunk once shouldStop is true', async () => {
    let stop = false;
    const text = await collectResponseText(stream('a', 'b', 'c'), {
      shouldStop: () => stop,
      onText: (t) => (stop = t === 'ab'),
    });

    expect(text).toBe('ab');
  });
});

describe('extractCodeBlock', () => {
  it('returns the first fenced block, or the whole text when there is none', () => {
    expect(extractCodeBlock('Sure:\n```text\n  inside  \n```\nbye')).toBe('inside');
    expect(extractCodeBlock('  plain answer \n')).toBe('plain answer');
  });
});
