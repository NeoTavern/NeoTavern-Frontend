import type {
  ApiChatContentPart,
  ApiChatMessage,
  Character,
  Persona,
  ProcessedWorldInfo,
  PromptTokenBreakdown,
  Tokenizer,
} from '../types';

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

/**
 * Builds the token breakdown shown in prompt itemization. Each prompt message is counted once.
 */
export async function computePromptTokenBreakdown(options: {
  messages: ApiChatMessage[];
  tokenizer: Tokenizer;
  mediaTokenCost: number;
  processedWorldInfo: ProcessedWorldInfo | null;
  character?: Character;
  persona: Persona;
  maxContext: number;
  maxTokens: number;
}): Promise<PromptTokenBreakdown> {
  const { messages, tokenizer, mediaTokenCost, processedWorldInfo, character, persona } = options;

  const messageCounts = await Promise.all(messages.map((m) => countTokens(m.content, tokenizer)));
  const promptTotal = messageCounts.reduce((a, b) => a + b, 0) + mediaTokenCost;

  let worldInfo = 0;
  if (processedWorldInfo) {
    const parts = [
      processedWorldInfo.worldInfoBefore,
      processedWorldInfo.worldInfoAfter,
      ...processedWorldInfo.anBefore,
      ...processedWorldInfo.anAfter,
      ...processedWorldInfo.emBefore,
      ...processedWorldInfo.emAfter,
      ...processedWorldInfo.depthEntries.flatMap((d) => d.entries),
      ...Object.values(processedWorldInfo.outletEntries).flat(),
    ];
    const fullWiText = parts.filter(Boolean).join('\n');
    if (fullWiText) worldInfo = await countTokens(fullWiText, tokenizer);
  }

  const breakdown: PromptTokenBreakdown = {
    systemTotal: 0,
    description: character ? await countTokens(character.description || '', tokenizer) : 0,
    personality: character ? await countTokens(character.personality || '', tokenizer) : 0,
    scenario: character ? await countTokens(character.scenario || '', tokenizer) : 0,
    examples: character ? await countTokens(character.mes_example || '', tokenizer) : 0,
    persona: await countTokens(persona.description || '', tokenizer),
    worldInfo,
    chatHistory: mediaTokenCost,
    extensions: 0,
    bias: 0,
    promptTotal,
    maxContext: options.maxContext,
    padding: options.maxContext - promptTotal - options.maxTokens,
  };

  messages.forEach((m, index) => {
    if (m.role === 'system') breakdown.systemTotal += messageCounts[index];
    else breakdown.chatHistory += messageCounts[index];
  });

  return breakdown;
}
