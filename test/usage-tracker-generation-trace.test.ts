import { describe, expect, it } from 'vitest';
import {
  formatGenerationTrace,
  selectGenerationTraceCaptures,
  type GenerationTraceLabels,
} from '../src/extensions/built-in/usage-tracker/generation-trace';
import type { UsageCaptureEntry } from '../src/extensions/built-in/usage-tracker/types';

const labels: GenerationTraceLabels = {
  request: 'Request',
  response: 'Response',
  type: 'Type',
  messageIndex: 'Message index',
  model: 'Model',
  status: 'Status',
  prompt: 'Prompt',
  message: 'Message',
  toolCalls: 'Tool Calls',
  reasoning: 'Reasoning',
  images: 'Images',
  error: 'Error',
  noData: 'No data captured.',
};

function capture(
  id: string,
  messageIndex: number,
  timestamp: number,
  source = 'core',
  messages: Array<{ role: string; name?: string; content: string }> = [],
): UsageCaptureEntry {
  return {
    id,
    generationId: `generation-${id}`,
    messageIndex,
    chatFile: 'chat-1',
    source,
    model: 'test-model',
    timestamp,
    request: { messages },
    response: { content: `response-${id}` },
    responseText: `response-${id}`,
    status: 'complete',
    sizeBytes: 1,
  };
}

describe('usage tracker generation trace', () => {
  it('selects every capture for the latest distinct message indices in chronological order', () => {
    const captures = [
      capture('old', 2, 10),
      capture('latest-agent', 6, 31, 'core.custom-agents'),
      capture('middle', 4, 20),
      capture('latest-core', 6, 30),
    ];

    expect(selectGenerationTraceCaptures(captures, 2).map((entry) => entry.id)).toEqual([
      'middle',
      'latest-core',
      'latest-agent',
    ]);
  });

  it('copies a readable trace while limiting each request to its trailing messages', () => {
    const coreCapture = capture('core', 6, 30, 'core', [
      { role: 'user', content: 'FLATTENED PROVIDER PROMPT WITH THE ENTIRE CONVERSATION' },
    ]);
    coreCapture.traceMessages = [
      { role: 'system', content: 'large fixed prompt' },
      { role: 'assistant', name: 'Hazel', content: 'Earlier response' },
      { role: 'user', name: 'Joe', content: 'Are you good?' },
      {
        role: 'system',
        name: 'Agent:micro-randomizer',
        content: 'Scene influence for the next assistant response:\nTENSION: Heighten existing tension.',
      },
    ];
    const selected = [
      coreCapture,
      capture('agent', 6, 31, 'core.custom-agents', [
        { role: 'user', name: 'Story Director', content: 'Evaluate the active direction.' },
      ]),
    ];

    const trace = formatGenerationTrace(selected, {
      requestMessageLimit: 2,
      formatSource: (source) => (source === 'core' ? 'Core' : 'Custom Agents'),
      labels,
    });

    expect(trace).not.toContain('FLATTENED PROVIDER PROMPT');
    expect(trace).not.toContain('large fixed prompt');
    expect(trace).not.toContain('Earlier response');
    expect(trace).toContain('1. Request\nType: Core\nMessage index: 6\nModel: test-model\nStatus: complete');
    expect(trace).toContain('Joe: Are you good?');
    expect(trace).toContain('Scene influence for the next assistant response:');
    expect(trace).toContain('1. Response\nMessage index: 6');
    expect(trace).toContain('response-core');
    expect(trace).toContain('2. Request\nType: Custom Agents');
    expect(trace).toContain('Story Director: Evaluate the active direction.');
  });

  it('uses a longer Markdown fence when captured content contains backticks', () => {
    const trace = formatGenerationTrace(
      [capture('fenced', 1, 1, 'core', [{ role: 'user', content: '```nested```' }])],
      { requestMessageLimit: 1, formatSource: () => 'Core', labels },
    );

    expect(trace).toContain('````text\nUSER: ```nested```\n````');
  });
});
