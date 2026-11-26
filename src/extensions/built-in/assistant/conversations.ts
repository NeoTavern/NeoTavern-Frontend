import localforage from 'localforage';
import type { ApiChatMessage } from '../../../types';
import { uuidv4 } from '../../../utils/commons';
import { jsonToXmlFragment } from '../../../utils/structured-response';
import type { StagedChange } from './changeset';
import type { AssistantRef } from './references';
import type { AssistantRequestFormat } from './types';

export interface ConversationToolCall {
  id: string;
  name: string;
  /** JSON string. */
  arguments: string;
}

export type ConversationMessage =
  /** `content` already has the `[Referenced]` block. */
  | { role: 'user'; content: string; refs: AssistantRef[] }
  | { role: 'assistant'; content: string; toolCalls: ConversationToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface AssistantConversation {
  id: string;
  /** The first user message's first line. */
  title: string;
  createdAt: number;
  updatedAt: number;
  /** What is sent to the model, in order. */
  messages: ConversationMessage[];
  changes: StagedChange[];
}

type ConversationStorage = Pick<LocalForage, 'getItem' | 'setItem' | 'removeItem' | 'iterate'>;

export function createConversation(): AssistantConversation {
  const now = Date.now();
  return { id: uuidv4(), title: '', createdAt: now, updatedAt: now, messages: [], changes: [] };
}

/** Appends the user's request; the first one also titles the conversation. */
export function appendUserMessage(
  conversation: AssistantConversation,
  message: { typed: string; content: string; refs: AssistantRef[] },
) {
  if (!conversation.title) conversation.title = message.typed.trim().split('\n')[0];
  conversation.messages.push({ role: 'user', content: message.content, refs: message.refs });
}

/** Conversations in localforage, one record each. Global, not tied to a chat. */
export class ConversationStore {
  constructor(
    private readonly storage: ConversationStorage = localforage.createInstance({
      name: 'neotavern',
      storeName: 'assistant-conversations',
    }),
  ) {}

  /** Newest first. */
  async list(): Promise<AssistantConversation[]> {
    const conversations: AssistantConversation[] = [];
    await this.storage.iterate((value: AssistantConversation) => {
      conversations.push(value);
    });
    return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<AssistantConversation | null> {
    return this.storage.getItem<AssistantConversation>(id);
  }

  /** Stores a plain copy, so a reactive conversation from the UI can be saved. */
  async save(conversation: AssistantConversation): Promise<void> {
    conversation.updatedAt = Date.now();
    await this.storage.setItem(conversation.id, JSON.parse(JSON.stringify(conversation)));
  }

  async delete(id: string): Promise<void> {
    await this.storage.removeItem(id);
  }
}

/** The `{ reply, calls }` object a structured-format turn returns. */
export interface StructuredTurn {
  reply: string;
  calls: { name: string; arguments: string }[];
}

/** An assistant turn as the model wrote it in a structured format. */
export function renderStructuredTurn(message: { content: string; toolCalls: ConversationToolCall[] }, format: string) {
  const turn: StructuredTurn = {
    reply: message.content,
    calls: message.toolCalls.map((call) => ({ name: call.name, arguments: call.arguments })),
  };
  return format === 'xml' ? jsonToXmlFragment(turn).trim() : JSON.stringify(turn);
}

function toolResultsMessage(results: Extract<ConversationMessage, { role: 'tool' }>[]): ApiChatMessage {
  const blocks = results.map((result) => `[${result.name}]\n${result.content}`);
  return { role: 'user', name: 'User', content: ['Tool results:', ...blocks].join('\n\n') };
}

/**
 * Maps the stored conversation to the request messages for `format`. With `'tools'`, assistant tool
 * calls and `tool` messages map one to one. Structured formats show assistant turns in their
 * `{ reply, calls }` form and send each run of tool results back as one "Tool results:" user message.
 */
export function toApiMessages(messages: ConversationMessage[], format: AssistantRequestFormat): ApiChatMessage[] {
  const result: ApiChatMessage[] = [];
  let pendingResults: Extract<ConversationMessage, { role: 'tool' }>[] = [];
  const flushResults = () => {
    if (pendingResults.length > 0) result.push(toolResultsMessage(pendingResults));
    pendingResults = [];
  };

  for (const message of messages) {
    if (message.role === 'tool') {
      if (format === 'tools') {
        result.push({ role: 'tool', name: message.name, tool_call_id: message.toolCallId, content: message.content });
      } else {
        pendingResults.push(message);
      }
      continue;
    }
    flushResults();

    if (message.role === 'user') {
      result.push({ role: 'user', name: 'User', content: message.content });
    } else if (format !== 'tools') {
      result.push({ role: 'assistant', name: 'Assistant', content: renderStructuredTurn(message, format) });
    } else if (message.toolCalls.length > 0) {
      result.push({
        role: 'assistant',
        name: 'Assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      });
    } else {
      result.push({ role: 'assistant', name: 'Assistant', content: message.content });
    }
  }
  flushResults();
  return result;
}
