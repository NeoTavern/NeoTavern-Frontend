import type { CustomPromptPostProcessing, GenerationMode } from '../constants';
import type { ApiModel, ApiProvider } from './api';
import type { Character } from './character';
import type { ChatMessage } from './chat';
import type {
  ApiChatMessage,
  ChatCompletionPayload,
  GenerationContext,
  GenerationResponse,
  PromptBuilderOptions,
  StreamedChunk,
  ToolGenerationConfig,
} from './generation';
import type { InstructTemplate } from './instruct';
import type { Persona } from './persona';
import type { ApiFormatter, Proxy, ReasoningTemplate, SamplerSettings, Settings, SettingsPath } from './settings';
import type { ToolDefinition, ToolInvocation } from './tools';
import type { ProcessedWorldInfo, WorldInfoBook, WorldInfoEntry, WorldInfoOptions } from './world-info';

export interface GenerationPayloadBuilderConfig {
  messages: ApiChatMessage[];
  model: string;
  samplerSettings: SamplerSettings;
  provider: ApiProvider;
  providerSpecific: Settings['api']['providerSpecific'];
  proxy?: Omit<Proxy, 'name'>;
  playerName?: string;
  modelList?: ApiModel[];
  formatter?: ApiFormatter;
  instructTemplate?: InstructTemplate;
  customPromptPostProcessing: CustomPromptPostProcessing;
  reasoningTemplate?: ReasoningTemplate;
  activeCharacter?: Character;
  toolConfig?: ToolGenerationConfig;
}

export interface LlmUsageData {
  source: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
  duration?: number;
  context?: string; // Optional context (e.g. chat file name, functionality name)
}

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
  'generation:started': [context: { controller: AbortController; generationId: string; activeCharacter?: Character }];
  'generation:finished': [
    result: { message: ChatMessage | null; error?: Error },
    context: { generationId: string; mode: GenerationMode },
  ];
  'generation:aborted': [context: { generationId: string }];
  'generation:before-message-create': [
    message: ChatMessage,
    context: { controller: AbortController; generationId: string },
  ];

  'prompt:building-started': [options: PromptBuilderOptions];
  'prompt:history-message-processing': [
    apiMessages: ApiChatMessage[],
    context: {
      originalMessage: ChatMessage;
      isGroupContext: boolean;
      characters: Character[];
      persona: Persona;
      index: number;
      chatLength: number;
    },
  ];
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

  /**
   * Fired when determining which characters should be included in the context/prompt.
   * Extensions can modify the `characters` array in the payload.
   */
  'generation:resolve-context': [payload: { characters: Character[] }];

  /**
   * Fired when a generation is requested, but the speaker is not forced.
   * Extensions can set `handled` to true to prevent the default generation behavior (e.g., to implement custom queuing logic like Group Chat).
   */
  'chat:generation-requested': [
    payload: { mode: GenerationMode; generationId: string; handled: boolean },
    context: { controller: AbortController },
  ];

  /**
   * Fired before the final ChatCompletionPayload is constructed.
   * This allows extensions to modify the raw configuration (messages, sampler settings, etc.)
   * before it is normalized for the specific API provider.
   */
  'generation:build-payload': [
    config: GenerationPayloadBuilderConfig,
    context: { controller: AbortController; generationId: string },
  ];

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

  // Tool Events
  'tool:registered': [tool: ToolDefinition];
  'tool:unregistered': [name: string];
  'tool:call-started': [payload: { name: string; message: string }];
  'tool:calls-performed': [invocations: ToolInvocation[]];

  // Analytics / Usage
  'llm:usage': [data: LlmUsageData];
}
