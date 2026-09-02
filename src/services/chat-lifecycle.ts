import type { GenerationMode } from '../constants';
import type { ChatMessage, ChatMetadata, PromptInjection } from '../types';

export interface ChatLifecycleContext {
  chatFile?: string;
  messages: ChatMessage[];
  metadata: ChatMetadata;
  signal: AbortSignal;
}

export interface AfterUserMessageContext extends ChatLifecycleContext {
  message: ChatMessage;
  messageIndex: number;
}

export interface GenerationTarget {
  message?: ChatMessage;
  messageIndex: number;
  swipeId?: number;
}

export interface BeforeGenerationContext extends ChatLifecycleContext {
  generationId: string;
  generationMode: GenerationMode;
  history: ChatMessage[];
  target?: GenerationTarget;
  promptInjections: PromptInjection[];
}

export interface BeforeGenerationResult {
  assistantContent?: string;
  includedPromptInjectionIds?: readonly string[];
}

export interface AfterGenerationContext extends ChatLifecycleContext {
  generationId: string;
  generationMode: GenerationMode;
  history: ChatMessage[];
  target: GenerationTarget;
  message: ChatMessage;
  includedPromptInjectionIds: readonly string[];
}

export interface ChatLifecycleHooks {
  afterUserMessage?(context: AfterUserMessageContext): Promise<void>;
  beforeGeneration?(context: BeforeGenerationContext): Promise<BeforeGenerationResult | void>;
  afterGeneration?(context: AfterGenerationContext): Promise<void>;
}

let provider: ChatLifecycleHooks | undefined;

export function registerChatLifecycleHooks(hooks: ChatLifecycleHooks): () => void {
  if (provider) throw new Error('A chat lifecycle provider is already registered');
  provider = hooks;
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    if (provider === hooks) provider = undefined;
  };
}

export async function runAfterUserMessage(context: AfterUserMessageContext): Promise<void> {
  context.signal.throwIfAborted();
  await provider?.afterUserMessage?.(context);
}

export async function runBeforeGeneration(
  context: BeforeGenerationContext,
): Promise<BeforeGenerationResult | undefined> {
  context.signal.throwIfAborted();
  return (await provider?.beforeGeneration?.(context)) ?? undefined;
}

export async function runAfterGeneration(context: AfterGenerationContext): Promise<void> {
  context.signal.throwIfAborted();
  await provider?.afterGeneration?.(context);
}
