import { macroService } from '../../../../services/macro-service';
import type {
  ApiChatMessage,
  Character,
  ChatMessage,
  Persona,
  PromptInjection,
  StructuredResponseOptions,
  StructuredResponsePrompted,
} from '../../../../types';
import { buildStructuredResponseSystemPrompt } from '../../../../utils/structured-response';
import { createStructuredResponse } from '../../_shared/runtime/structured-request-format';
import type {
  GraphLlmRequest,
  LlmDispatcher,
  TemplateRenderer,
  TemplateRenderRequest,
} from '../registry/node-definition';
import type { JsonObject, JsonValue } from '../graph/contracts';
import type { MessageValue } from './contracts';
import { assertAgentPromptMacros, forbiddenAgentMacros } from './prompt-security';
import type { CustomAgentsHostAPI } from './api';

export type GenerationInjectionSource = (
  generationId: string,
) => { injections: PromptInjection[]; acknowledge(ids: readonly string[]): void } | undefined;

function targetMessage(target: MessageValue, source?: ChatMessage): ChatMessage {
  return {
    ...(source ?? {
      send_date: '',
      original_avatar: '',
      swipes: [],
      swipe_info: [],
      swipe_id: 0,
      extra: {},
    }),
    name: target.name,
    mes: target.content,
    is_user: target.role === 'USER',
    is_system: target.role === 'SYSTEM',
  };
}

function selectHistory(request: GraphLlmRequest): ChatMessage[] {
  if (request.assembly.type === 'STANDALONE' || request.assembly.history === 'NONE') return [];
  const targetHistory = request.assembly.history.endsWith('_TARGET');
  const target = targetHistory ? request.promptContext.targetMessage : undefined;
  if (targetHistory && !target) throw new Error('TARGET history requires a target message');
  let selected = [...request.promptContext.chatHistory];
  if (target) {
    selected = selected.slice(0, target.index + 1);
    if (target.index < selected.length)
      selected = selected.map((message, index) => (index === target.index ? targetMessage(target, message) : message));
    else selected.push(targetMessage(target));
  }
  return selected;
}

function role(value: 'SYSTEM' | 'USER' | 'ASSISTANT'): 'system' | 'user' | 'assistant' {
  return value.toLowerCase() as 'system' | 'user' | 'assistant';
}

function taskMessage(taskRole: 'SYSTEM' | 'USER' | 'ASSISTANT', content: string): ApiChatMessage {
  return { role: role(taskRole), name: 'Custom Agent', content };
}

function responseFormat(request: GraphLlmRequest): StructuredResponseOptions {
  return createStructuredResponse(request.structuredFormat.toLowerCase() as 'native' | 'json' | 'xml', {
    name: request.nodeId,
    value: request.outputSchema,
    strict: true,
  });
}

function eventGenerationId(request: GraphLlmRequest): string | undefined {
  return 'generationId' in request.event ? request.event.generationId : undefined;
}

function captureMessageIndex(request: GraphLlmRequest): number | undefined {
  const historyLength = request.promptContext.chatHistory.length;
  if ('message' in request.event) return request.event.message.index;
  if ('targetMessage' in request.event && request.event.targetMessage) return request.event.targetMessage.index;
  if (request.promptContext.targetMessage) return request.promptContext.targetMessage.index;
  if ('generationMode' in request.event && request.event.generationMode === 'NEW') return historyLength;
  return historyLength > 0 ? historyLength - 1 : undefined;
}

function macroContext(request: TemplateRenderRequest | GraphLlmRequest, selected: readonly ChatMessage[]) {
  const characters = request.promptContext.currentCharacter
    ? ([request.promptContext.currentCharacter] as unknown as Character[])
    : [];
  const persona = request.promptContext.persona as unknown as Persona | null;
  return {
    characters,
    activeCharacter: characters[0],
    persona: persona ?? undefined,
    chatHistory: [...selected],
    forbiddenMacros: forbiddenAgentMacros,
  };
}

function namespaces(request: TemplateRenderRequest | GraphLlmRequest): Record<string, unknown> {
  return {
    event: request.event,
    config: request.configuration,
    state: request.state,
    ...(request.iteration ? { iteration: request.iteration } : {}),
    input: request.variables,
  };
}

export class GraphHostTemplateRenderer implements TemplateRenderer {
  public constructor(private readonly api: CustomAgentsHostAPI) {}

  public async render(request: TemplateRenderRequest): Promise<string> {
    request.signal.throwIfAborted();
    assertAgentPromptMacros(request.template);
    const rendered = this.api.macro.process(
      request.template,
      macroContext(request, request.promptContext.chatHistory),
      namespaces(request),
    );
    request.signal.throwIfAborted();
    return rendered;
  }
}

export class GraphHostLlmDispatcher implements LlmDispatcher {
  public constructor(
    private readonly api: CustomAgentsHostAPI,
    private readonly generationInjections?: GenerationInjectionSource,
  ) {}

  public async dispatch(request: GraphLlmRequest): Promise<JsonValue> {
    request.signal.throwIfAborted();
    if (request.source !== 'core.custom-agents') throw new Error(`Unsupported LLM usage source ${request.source}`);
    assertAgentPromptMacros(request.prompt);
    const selected = selectHistory(request);
    const context = macroContext(request, selected);
    const prompt = this.api.macro.process(request.prompt, context, namespaces(request));
    const format = responseFormat(request);
    let messages: ApiChatMessage[];

    if (request.assembly.type === 'STANDALONE') {
      const content =
        format.format === 'native'
          ? prompt
          : `${buildStructuredResponseSystemPrompt(
              format as StructuredResponsePrompted,
              macroService.createEvaluationSession(context),
            )}\n\n${prompt}`;
      messages = [taskMessage(request.assembly.role, content)];
    } else {
      const placement = request.assembly.placement;
      const taskInjectionId = JSON.stringify([
        'custom-agent-graph-task',
        request.flowId,
        request.nodeId,
        request.requestId,
      ]);
      const outerGenerationId = eventGenerationId(request);
      const outer = outerGenerationId ? this.generationInjections?.(outerGenerationId) : undefined;
      const built = await this.api.chat.buildPrompt({
        chatHistory: selected,
        structuredResponse: format,
        generationId: request.requestId,
        ...(placement.type === 'IN_CHAT'
          ? {
              promptInjections: [
                ...(outer?.injections ?? []),
                {
                  id: taskInjectionId,
                  content: prompt,
                  role: role(placement.role),
                  name: 'Custom Agent',
                  placement: 'in-chat' as const,
                  depth: placement.depth,
                },
              ],
            }
          : outer?.injections.length
            ? { promptInjections: outer.injections }
            : {}),
      });
      outer?.acknowledge(built.includedPromptInjectionIds ?? []);
      if (placement.type === 'IN_CHAT' && !built.includedPromptInjectionIds?.includes(taskInjectionId))
        throw new Error('IN_CHAT task prompt was excluded by prompt budgeting');
      messages =
        placement.type === 'AFTER_CONTEXT' ? [...built.messages, taskMessage(placement.role, prompt)] : built.messages;
    }

    request.signal.throwIfAborted();
    let output: object | undefined;
    let parseError: Error | undefined;
    const response = await this.api.llm.generate(messages, {
      ...(request.connectionProfileId === null ? {} : { connectionProfile: request.connectionProfileId }),
      signal: request.signal,
      samplerOverrides: { stream: false },
      structuredResponse: format,
      generationId: request.requestId,
      captureMessageIndex: captureMessageIndex(request),
      onCompletion: (completion) => {
        output = completion.structured_content;
        parseError = completion.parse_error;
      },
    });
    if (Symbol.asyncIterator in response) {
      for await (const _chunk of response) request.signal.throwIfAborted();
    }
    request.signal.throwIfAborted();
    if (parseError) throw parseError;
    if (output === undefined) throw new Error('LLM did not return structured output');
    return structuredClone(output) as JsonValue;
  }
}

export function promptContextFromHost(
  api: CustomAgentsHostAPI,
  chatHistory: readonly ChatMessage[],
  target?: MessageValue,
): {
  chatHistory: readonly ChatMessage[];
  targetMessage?: MessageValue;
  currentCharacter: JsonObject | null;
  persona: JsonObject | null;
} {
  const character = api.character.getActives()[0];
  const persona = api.persona.getActive();
  return {
    chatHistory: structuredClone(chatHistory),
    ...(target ? { targetMessage: structuredClone(target) } : {}),
    currentCharacter: character ? (structuredClone(character) as unknown as JsonObject) : null,
    persona: persona ? (structuredClone(persona) as unknown as JsonObject) : null,
  };
}
