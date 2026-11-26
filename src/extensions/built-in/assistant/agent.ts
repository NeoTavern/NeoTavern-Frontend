import { macroService } from '../../../services/macro-service';
import { ToolService } from '../../../services/tool.service';
import type { ApiChatMessage, ExtensionAPI, GenerationResponse, StructuredResponsePrompted } from '../../../types';
import type { ToolDefinition } from '../../../types/tools';
import { uuidv4 } from '../../../utils/commons';
import { buildStructuredResponseSystemPrompt } from '../../../utils/structured-response';
import { generateStructuredResult } from '../_shared/runtime/structured-generation';
import { createStructuredResponse, type StructuredRequestFormat } from '../_shared/runtime/structured-request-format';
import {
  toApiMessages,
  type AssistantConversation,
  type ConversationMessage,
  type ConversationToolCall,
  type StructuredTurn,
} from './conversations';
import type { AssistantRequestFormat } from './types';

export type AgentAPI = {
  llm: Pick<ExtensionAPI['llm'], 'generate'>;
  api: Pick<ExtensionAPI['api'], 'getConnectionProfile'>;
  settings: Pick<ExtensionAPI['settings'], 'getGlobal'>;
  tools: Pick<ExtensionAPI['tools'], 'getEnabled'>;
};

export type AgentTurnResult =
  | { status: 'done' }
  | { status: 'aborted' }
  /** `'tools'` format with a profile whose model can't call tools. Nothing was sent. */
  | { status: 'unsupported' }
  /** A structured reply didn't parse. Nothing was appended; running the turn again retries it. */
  | { status: 'parse-error'; error: string; rawContent: string };

export interface AgentTurnOptions {
  /** Appended to in place. The last message is the user's request (or tool results, on a retry). */
  conversation: Pick<AssistantConversation, 'messages'>;
  /** The assistant's own tools (`createAssistantTools`). */
  tools: ToolDefinition[];
  format: AssistantRequestFormat;
  profile: string;
  signal?: AbortSignal;
  /** Called after each message the turn appends. */
  onMessage?: (message: ConversationMessage) => void;
}

const SYSTEM_PROMPT = [
  'You are the assistant of a roleplay chat app. You help the user edit characters, lorebooks, chat messages and their persona.',
  'Edit tools only propose changes: the user reviews each one as a diff and accepts or rejects it. Nothing changes until they accept.',
  'Content the user mentioned is inlined in a [Referenced] block. Use it instead of reading the same thing again; use the read tools for anything else.',
  'After proposing changes, reply briefly: say what you proposed, without repeating the full text.',
].join('\n');

const STRUCTURED_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Your message to the user.' },
    calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          arguments: { type: 'string', description: 'The arguments as a JSON object string.' },
        },
        required: ['name', 'arguments'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'calls'],
  additionalProperties: false,
};

/**
 * Whether the profile's provider and model support native tool calling. Fields the profile leaves
 * out resolve from the global API settings, as generation does.
 */
export function isToolCallingSupported(api: Pick<AgentAPI, 'api' | 'settings'>, profileId: string): boolean {
  const profile = api.api.getConnectionProfile(profileId);
  const provider = profile?.provider ?? api.settings.getGlobal('api.provider');
  const model = profile?.model ?? api.settings.getGlobal('api.selectedProviderModels')[provider] ?? '';
  const postProcessing =
    profile?.customPromptPostProcessing ?? api.settings.getGlobal('api.customPromptPostProcessing');
  return ToolService.isToolCallingSupported(provider, model, postProcessing, true);
}

function structuredSystemPrompt(tools: ToolDefinition[], format: StructuredRequestFormat): string {
  const toolList = tools
    .map((tool) => `- ${tool.name}: ${tool.description}\n  parameters: ${JSON.stringify(tool.parameters)}`)
    .join('\n');
  const parts = [
    SYSTEM_PROMPT,
    [
      'Answer with an object { reply, calls }. To use tools, list them in calls, each with its name and its arguments as a JSON object string.',
      'The results come back in a "Tool results:" message. When you need no more tools, return an empty calls list with your reply.',
      `Tools:\n${toolList}`,
    ].join('\n'),
  ];
  if (format !== 'native') {
    const response = createStructuredResponse(format, { name: 'assistant_turn', value: STRUCTURED_SCHEMA });
    parts.push(
      buildStructuredResponseSystemPrompt(
        response as StructuredResponsePrompted,
        macroService.createEvaluationSession({ characters: [] }),
      ),
    );
  }
  return parts.join('\n\n');
}

async function runCall(call: ConversationToolCall, ownTools: Map<string, ToolDefinition>): Promise<string> {
  const own = ownTools.get(call.name);
  try {
    if (!own) return await ToolService.invokeTool(call.name, call.arguments);
    const result = await own.action(ToolService.parseParameters(call.arguments, own.parameters));
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Runs one request of the conversation: generates, runs the tool calls the model makes, and generates
 * again until it answers without tool calls or `signal` aborts. There's no iteration cap.
 */
export async function runAgentTurn(api: AgentAPI, options: AgentTurnOptions): Promise<AgentTurnResult> {
  const { conversation, tools, format, profile, signal } = options;
  if (format === 'tools' && !isToolCallingSupported(api, profile)) return { status: 'unsupported' };

  const ownTools = new Map(tools.map((tool) => [tool.name, tool]));
  const systemPrompt =
    format === 'tools' ? SYSTEM_PROMPT : structuredSystemPrompt([...tools, ...api.tools.getEnabled()], format);
  const append = (message: ConversationMessage) => {
    conversation.messages.push(message);
    options.onMessage?.(message);
  };

  while (true) {
    if (signal?.aborted) return { status: 'aborted' };
    const messages: ApiChatMessage[] = [
      { role: 'system', name: 'System', content: systemPrompt },
      ...toApiMessages(conversation.messages, format),
    ];

    let reply: { content: string; toolCalls: ConversationToolCall[] };
    try {
      if (format === 'tools') {
        reply = await generateWithTools(api, messages, tools, profile, signal);
      } else {
        const generation = await generateStructuredResult<StructuredTurn>(api, {
          messages,
          options: {
            connectionProfile: profile,
            signal,
            samplerOverrides: { stream: false },
            structuredResponse: createStructuredResponse(format, { name: 'assistant_turn', value: STRUCTURED_SCHEMA }),
          },
          streamErrorMessage: 'Assistant generation unexpectedly returned a stream.',
          missingStructuredContentMessage: 'The model returned no structured content.',
        });
        if (signal?.aborted) return { status: 'aborted' };
        if (!generation.structuredContent) {
          return { status: 'parse-error', error: generation.parseError!, rawContent: generation.rawContent };
        }
        const turn = generation.structuredContent;
        reply = {
          content: turn.reply ?? '',
          toolCalls: (turn.calls ?? []).map((call) => ({ id: uuidv4(), name: call.name, arguments: call.arguments })),
        };
      }
    } catch (error) {
      if (signal?.aborted) return { status: 'aborted' };
      throw error;
    }
    if (signal?.aborted) return { status: 'aborted' };

    append({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });
    if (reply.toolCalls.length === 0) return { status: 'done' };

    // All results are appended before the next abort check, so the history never has calls without results.
    for (const call of reply.toolCalls) {
      append({ role: 'tool', toolCallId: call.id, name: call.name, content: await runCall(call, ownTools) });
    }
  }
}

async function generateWithTools(
  api: AgentAPI,
  messages: ApiChatMessage[],
  tools: ToolDefinition[],
  profile: string,
  signal: AbortSignal | undefined,
): Promise<{ content: string; toolCalls: ConversationToolCall[] }> {
  const response = await api.llm.generate(messages, {
    connectionProfile: profile,
    signal,
    samplerOverrides: { stream: false },
    toolConfig: { includeRegisteredTools: true, bypassGlobalCheck: true, additionalTools: tools },
  });
  if (Symbol.asyncIterator in response) throw new Error('Assistant generation unexpectedly returned a stream.');
  const { content, tool_calls } = response as GenerationResponse;
  return {
    content: content ?? '',
    toolCalls: (tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
  };
}
