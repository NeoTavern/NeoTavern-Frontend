import type { ApiChatMessage, ExtensionAPI, GenerationResponse, LlmGenerationOptions } from '../../../../types';

interface StructuredGenerationAPI {
  llm: Pick<ExtensionAPI['llm'], 'generate'>;
}

export interface StructuredGenerationResult<TStructured> {
  structuredContent?: TStructured;
  rawContent: string;
  parseError?: string;
}

interface GenerateStructuredResultOptions {
  messages: ApiChatMessage[];
  options: LlmGenerationOptions;
  streamErrorMessage: string;
  missingStructuredContentMessage: string;
  collectStreamContent?: boolean;
}

export async function generateStructuredResult<TStructured>(
  api: StructuredGenerationAPI,
  {
    messages,
    options,
    streamErrorMessage,
    missingStructuredContentMessage,
    collectStreamContent = false,
  }: GenerateStructuredResultOptions,
): Promise<StructuredGenerationResult<TStructured>> {
  let completionStructuredContent: object | undefined;
  let completionParseError: Error | undefined;
  const response = await api.llm.generate(messages, {
    ...options,
    onCompletion(data) {
      completionStructuredContent = data.structured_content;
      completionParseError = data.parse_error;
      options.onCompletion?.(data);
    },
  });

  if (Symbol.asyncIterator in response) {
    let rawContent = '';
    for await (const chunk of response) {
      if (collectStreamContent) rawContent += chunk.delta;
    }
    return { rawContent, parseError: streamErrorMessage };
  }

  const generationResponse = response as GenerationResponse;
  const structuredContent = (generationResponse.structured_content ?? completionStructuredContent) as
    | TStructured
    | undefined;

  return {
    structuredContent,
    rawContent: generationResponse.content,
    parseError: structuredContent ? undefined : (completionParseError?.message ?? missingStructuredContentMessage),
  };
}

interface RepairableStructuredGenerationResult {
  rawContent: string;
  parseError?: string;
  messages?: ApiChatMessage[];
}

interface RepairStructuredGenerationOptions<TGeneration extends RepairableStructuredGenerationResult, TValue> {
  generation: TGeneration;
  messages: ApiChatMessage[];
  maxRepairs: number;
  getValue: (generation: TGeneration) => TValue | undefined;
  repair: (input: {
    messages: ApiChatMessage[];
    rawContent: string;
    parseError: string;
    repairCount: number;
  }) => Promise<TGeneration>;
  onRepair?: (repairCount: number, maxRepairs: number) => void | Promise<void>;
}

export async function repairStructuredGeneration<TGeneration extends RepairableStructuredGenerationResult, TValue>({
  generation,
  messages,
  maxRepairs,
  getValue,
  repair,
  onRepair,
}: RepairStructuredGenerationOptions<TGeneration, TValue>): Promise<TGeneration> {
  let currentGeneration = generation;
  let repairMessages = messages;
  let repairCount = 0;

  while (
    !getValue(currentGeneration) &&
    currentGeneration.parseError &&
    currentGeneration.rawContent.trim() &&
    repairCount < maxRepairs
  ) {
    repairCount += 1;
    await onRepair?.(repairCount, maxRepairs);
    currentGeneration = await repair({
      messages: repairMessages,
      rawContent: currentGeneration.rawContent,
      parseError: currentGeneration.parseError,
      repairCount,
    });
    repairMessages = currentGeneration.messages ?? repairMessages;
  }

  return currentGeneration;
}
