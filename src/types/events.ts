import type { Character } from './character';
import type { ChatMessage } from './chat';
import type {
  ApiChatMessage,
  ChatCompletionPayload,
  GenerationContext,
  GenerationResponse,
  PromptBuilderOptions,
  StreamedChunk,
} from './generation';
import type { Persona } from './persona';
import type { SettingsPath } from './settings';
import type { ProcessedWorldInfo, WorldInfoBook, WorldInfoEntry, WorldInfoOptions } from './world-info';

export interface ExtensionEventMap {
  // General Application Events
  'app:loaded': [];
  'chat:cleared': [];
  'chat:entered': [chatFile: string];
  'chat:deleted': [chatFile: string];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  'setting:changed': [path: SettingsPath, value: any, oldValue: any];

  // Message Events
  'chat:before-message-create': [message: ChatMessage, controller: AbortController];
  'message:created': [message: ChatMessage];
  'message:updated': [index: number, message: ChatMessage];
  'message:deleted': [indices: number[]];
  'message:swipe-deleted': [{ messageIndex: number; swipeIndex: number; newSwipeId: number }];

  // Character Events
  'character:created': [character: Character];
  'character:updated': [character: Character, changes: Partial<Character>];
  'character:deleted': [avatar: string];
  'character:imported': [character: Character];
  'character:first-message-updated': [avatar: string, characterData: Character];

  // Persona Events
  'persona:created': [persona: Persona];
  'persona:updated': [persona: Persona];
  'persona:deleted': [avatarId: string];
  'persona:activated': [persona: Persona | null];

  // World Info Events
  'world-info:book-created': [bookName: string];
  'world-info:book-updated': [book: WorldInfoBook];
  'world-info:book-deleted': [bookName: string];
  'world-info:book-renamed': [oldName: string, newName: string];
  'world-info:book-imported': [bookName: string];
  'world-info:entry-created': [bookName: string, entry: WorldInfoEntry];
  'world-info:entry-updated': [bookName: string, entry: WorldInfoEntry];
  'world-info:entry-deleted': [bookName: string, uid: number];

  // Generation Flow Events
  'generation:started': [context: { controller: AbortController; generationId: string }];
  'generation:finished': [result: { message: ChatMessage | null; error?: Error }, context: { generationId: string }];
  'generation:before-message-create': [
    message: ChatMessage,
    context: { controller: AbortController; generationId: string },
  ];

  'prompt:building-started': [options: PromptBuilderOptions];
  'prompt:built': [messages: ApiChatMessage[], context: { generationId: string }];
  'world-info:processing-started': [options: WorldInfoOptions];
  'world-info:entry-activated': [entry: WorldInfoEntry, context: { generationId: string }];
  'world-info:processing-finished': [result: ProcessedWorldInfo, context: { generationId: string }];

  /**
   * Data Processing Events
   * Listeners for these events can modify the data object passed as the first argument.
   * They are fired sequentially and awaited by the core application.
   */
  'process:generation-context': [context: GenerationContext];
  'process:request-payload': [
    payload: ChatCompletionPayload,
    context: { controller: AbortController; generationId: string },
  ];
  'process:response': [
    response: GenerationResponse,
    context: { payload: ChatCompletionPayload; controller: AbortController; generationId: string },
  ];
  'process:stream-chunk': [
    chunk: StreamedChunk,
    context: { payload: ChatCompletionPayload; controller: AbortController; generationId: string },
  ];
}
