import type { UsageCaptureEntry } from './types';

export interface GenerationTraceLabels {
  request: string;
  response: string;
  type: string;
  messageIndex: string;
  model: string;
  status: string;
  prompt: string;
  message: string;
  toolCalls: string;
  reasoning: string;
  images: string;
  error: string;
  noData: string;
}

export interface GenerationTraceOptions {
  requestMessageLimit: number;
  formatSource: (source: string) => string;
  labels: GenerationTraceLabels;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatContent(content: unknown): string {
  if (!Array.isArray(content)) return stringify(content);
  return content
    .map((part) => {
      if (!isRecord(part)) return stringify(part);
      if (part.type === 'text') return typeof part.text === 'string' ? part.text : '';
      return stringify(part);
    })
    .filter((part) => part.trim().length > 0)
    .join('\n');
}

function formatRequest(capture: UsageCaptureEntry, messageLimit: number, labels: GenerationTraceLabels): string {
  const request = capture.request;
  if (!isRecord(request)) return stringify(request);
  const messages = capture.traceMessages ?? request.messages;
  if (Array.isArray(messages)) {
    return messages
      .slice(-messageLimit)
      .map((message) => {
        if (!isRecord(message)) return stringify(message);
        const label =
          typeof message.name === 'string' && message.name
            ? message.name
            : typeof message.role === 'string'
              ? message.role.toUpperCase()
              : labels.message;
        const content = formatContent(message.content);
        const toolCalls = message.tool_calls ? `\n${labels.toolCalls}:\n${stringify(message.tool_calls)}` : '';
        return `${label}: ${content}${toolCalls}`;
      })
      .join('\n\n');
  }
  if (typeof request.prompt === 'string') return `${labels.prompt}:\n${request.prompt}`;
  return stringify(request);
}

function formatResponse(capture: UsageCaptureEntry, labels: GenerationTraceLabels): string {
  if (capture.responseText?.trim()) return capture.responseText;
  if (!isRecord(capture.response)) return stringify(capture.response);

  const sections: string[] = [];
  if (typeof capture.response.content === 'string' && capture.response.content.trim())
    sections.push(capture.response.content);
  if (typeof capture.response.reasoning === 'string' && capture.response.reasoning.trim())
    sections.push(`${labels.reasoning}:\n${capture.response.reasoning}`);
  if (capture.response.tool_calls) sections.push(`${labels.toolCalls}:\n${stringify(capture.response.tool_calls)}`);
  if (capture.response.images) sections.push(`${labels.images}:\n${stringify(capture.response.images)}`);
  if (typeof capture.response.error === 'string' && capture.response.error.trim())
    sections.push(`${labels.error}:\n${capture.response.error}`);
  return sections.length ? sections.join('\n\n') : stringify(capture.response);
}

function fenced(text: string): string {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text}\n${fence}`;
}

export function selectGenerationTraceCaptures(
  captures: UsageCaptureEntry[],
  generationCount: number,
): UsageCaptureEntry[] {
  const selectedIndices = new Set(
    [...new Set(captures.flatMap((capture) => (capture.messageIndex === undefined ? [] : [capture.messageIndex])))]
      .sort((left, right) => right - left)
      .slice(0, generationCount),
  );
  return captures
    .filter((capture) => capture.messageIndex !== undefined && selectedIndices.has(capture.messageIndex))
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
}

export function formatGenerationTrace(captures: UsageCaptureEntry[], options: GenerationTraceOptions): string {
  return captures
    .map((capture, index) => {
      const number = index + 1;
      const metadata = [
        `${options.labels.type}: ${options.formatSource(capture.source)}`,
        `${options.labels.messageIndex}: ${capture.messageIndex ?? '-'}`,
        `${options.labels.model}: ${capture.model}`,
        `${options.labels.status}: ${capture.status}`,
      ].join('\n');
      const request = formatRequest(capture, options.requestMessageLimit, options.labels) || options.labels.noData;
      const response = formatResponse(capture, options.labels) || options.labels.noData;
      return `${number}. ${options.labels.request}\n${metadata}\n\n${fenced(request)}\n\n${number}. ${options.labels.response}\n${options.labels.messageIndex}: ${capture.messageIndex ?? '-'}\n\n${fenced(response)}`;
    })
    .join('\n\n');
}
