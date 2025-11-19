import type { ValueForPath, Path } from './utils';
import type { PromptBuilder } from '../utils/prompt-builder';
import type { WorldInfoProcessor } from '../utils/world-info-processor';
import type { EventPriority } from '../constants';
import type { ChatMessage, ChatMetadata } from './chat';
import type { SamplerSettings, Settings, SettingsPath } from './settings';
import type { ApiChatMessage, ChatCompletionPayload, GenerationResponse, StreamedChunk } from './generation';
import type { Character } from './character';
import type { Persona, PersonaDescription } from './persona';
import type { WorldInfoBook, WorldInfoEntry, WorldInfoSettings } from './world-info';
import type { MenuType } from './common';
import type { ExtensionEventMap } from './events';
import type { PopupShowOptions } from './popup';
import type { Component, App } from 'vue';

export interface LlmGenerationOptions {
  connectionProfileName?: string;
  samplerOverrides?: Partial<SamplerSettings>;
  signal?: AbortSignal;
}

export enum MountableComponent {
  ConnectionProfileSelector = 'ConnectionProfileSelector',
}

/**
 * Mapping of mountable components to their required props.
 * This ensures type safety when mounting built-in components via the Extension API.
 */
export interface MountableComponentPropsMap {
  [MountableComponent.ConnectionProfileSelector]: {
    modelValue?: string;
    'onUpdate:modelValue'?: (value: string | undefined) => void;
  };
}

export interface ExtensionMetadata {
  /** The unique ID of the extension (from manifest.name) */
  id: string;
  /** The DOM ID of the container element allocated for this extension */
  containerId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ExtensionAPI<TSettings = Record<string, any>> {
  /**
   * Metadata about the current extension instance.
   */
  meta: ExtensionMetadata;

  chat: {
    sendMessage: (messageText: string, options?: { triggerGeneration?: boolean }) => Promise<void>;
    getHistory: () => readonly ChatMessage[];
    getLastMessage: () => Readonly<ChatMessage> | null;
    insertMessage: (message: Omit<ChatMessage, 'send_date'> & { send_date?: string }, index?: number) => void;
    updateMessage: (index: number, newContent: string, newReasoning?: string) => Promise<void>;
    updateMessageObject: (index: number, updates: Partial<ChatMessage>) => Promise<void>;
    deleteMessage: (index: number) => Promise<void>;
    regenerateResponse: () => Promise<void>;
    continueResponse: () => Promise<void>;
    clear: () => Promise<void>;
    abortGeneration: () => void;
    generate: (
      payload: ChatCompletionPayload,
      signal?: AbortSignal,
    ) => Promise<GenerationResponse | (() => AsyncGenerator<StreamedChunk>)>;
    buildPayload: (messages: ApiChatMessage[], samplerOverrides?: Partial<SamplerSettings>) => ChatCompletionPayload;

    metadata: {
      get: () => Readonly<ChatMetadata>;
      set: (metadata: ChatMetadata) => void;
      update: (updates: Partial<ChatMetadata>) => void;
    };

    PromptBuilder: typeof PromptBuilder;
    WorldInfoProcessor: typeof WorldInfoProcessor;
  };
  settings: {
    /**
     * (SCOPED) Retrieves a setting value from this extension's dedicated storage.
     * @param path The key for the setting within the extension's scope. If it's undefined, returns the entire settings object.
     * @returns The value of the setting.
     */
    get: <P extends Path<TSettings> | undefined = undefined>(
      path?: P,
    ) => P extends undefined ? TSettings : ValueForPath<TSettings, P & string>;

    /**
     * (GLOBAL, READ-ONLY) Retrieves a setting value from the main application settings.
     * @param path The dot-notation path to the global setting (e.g., 'chat.sendOnEnter').
     * @returns The value of the setting.
     */
    getGlobal: <P extends SettingsPath>(path: P) => Readonly<ValueForPath<Settings, P>>;

    /**
     * (SCOPED) Updates a single setting value in this extension's dedicated storage.
     * @param path The key for the setting within the extension's scope. If it's undefined, replaces the entire settings object.
     * @param value The new value to set.
     */
    set: <P extends Path<TSettings> | undefined = undefined>(
      path: P,
      value: P extends undefined ? TSettings : ValueForPath<TSettings, P & string>,
    ) => void;

    /**
     * Sets a global setting value in the main application settings.
     * @param path The dot-notation path to the global setting (e.g., 'chat.sendOnEnter').
     * @param value The new value.
     */
    setGlobal: <P extends SettingsPath>(path: P, value: ValueForPath<Settings, P>) => void;
    save: () => void;
  };
  character: {
    getActive: () => Readonly<Character> | null;
    getAll: () => readonly Character[];
    get: (avatar: string) => Readonly<Character> | null;
    setActive: (avatar: string) => Promise<void>;
    updateActive: (data: Partial<Character>) => void;
    create: (character: Character, avatarImage?: File) => Promise<void>;
    delete: (avatar: string, deleteChats?: boolean) => Promise<void>;
    update: (avatar: string, data: Partial<Character>) => Promise<void>;
  };
  persona: {
    getActive: () => Readonly<Persona> | null;
    getAll: () => readonly Persona[];
    setActive: (avatarId: string) => void;
    updateActiveField: <K extends keyof PersonaDescription>(field: K, value: PersonaDescription[K]) => Promise<void>;
    delete: (avatarId: string) => Promise<void>;
  };
  worldInfo: {
    getSettings: () => Readonly<WorldInfoSettings>;
    updateSettings: (settings: Partial<WorldInfoSettings>) => void;
    getAllBookNames: () => readonly string[];
    getBook: (name: string) => Promise<Readonly<WorldInfoBook> | null>;
    getActiveBookNames: () => readonly string[];
    setActiveBookNames: (names: string[]) => void;
    updateEntry: (bookName: string, entry: WorldInfoEntry) => void;
  };
  ui: {
    showToast: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
    openPanel: (panelName: MenuType) => void;
    closePanel: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    showPopup: (options: PopupShowOptions) => Promise<{ result: number; value: any }>;

    /**
     * Registers a custom sidebar component to the right sidebar area.
     * @param id Unique identifier for the sidebar view.
     * @param component The Vue component to render. If null, a generic <div> container is created for vanilla DOM manipulation.
     * @param options Display options (icon, title, props).
     */
    registerSidebar: (
      id: string,
      component: Component | null,
      side: 'left' | 'right',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options?: { title?: string; icon?: string; props?: Record<string, any> },
    ) => void;

    /**
     * Opens a specific sidebar view.
     * @param id The ID of the sidebar to open.
     */
    openSidebar: (id: string) => void;

    /**
     * Mounts a predefined system component to the DOM.
     */
    mountComponent: <T extends MountableComponent>(
      container: HTMLElement,
      componentName: T,
      props: MountableComponentPropsMap[T],
    ) => Promise<void>;
    /**
     * Mounts a raw Vue component to a specific DOM element.
     * This is primarily for Built-in extensions that have access to compiled .vue files.
     *
     * @param container The DOM element to mount into.
     * @param component The Vue component to render.
     * @param props Props to pass to the component.
     * @returns The Vue Application instance (useful for unmounting later).
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mount: (container: HTMLElement, component: Component, props?: Record<string, any>) => App;
  };
  events: {
    on: <E extends keyof ExtensionEventMap>(
      eventName: E,
      listener: (...args: ExtensionEventMap[E]) => Promise<void> | void,
      priority?: number | EventPriority,
    ) => () => void;
    off: <E extends keyof ExtensionEventMap>(
      eventName: E,
      listener: (...args: ExtensionEventMap[E]) => Promise<void> | void,
    ) => void;
    emit: <E extends keyof ExtensionEventMap>(eventName: E, ...args: ExtensionEventMap[E]) => Promise<void>;
  };
  llm: {
    generate: (
      messages: ApiChatMessage[],
      options?: LlmGenerationOptions,
    ) => Promise<GenerationResponse | (() => AsyncGenerator<StreamedChunk>)>;
  };
}
