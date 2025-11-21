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
import type { ExtensionEventMap } from './events';
import type { PopupShowOptions } from './popup';
import type { Component } from 'vue';
import type { DrawerType } from './common';

export interface LlmGenerationOptions {
  connectionProfileName?: string;
  samplerOverrides?: Partial<SamplerSettings>;
  signal?: AbortSignal;
}

export enum MountableComponent {
  ConnectionProfileSelector = 'ConnectionProfileSelector',
  AppButton = 'AppButton',
  AppCheckbox = 'AppCheckbox',
  AppIcon = 'AppIcon',
  AppIconButton = 'AppIconButton',
  AppInput = 'AppInput',
  AppSelect = 'AppSelect',
  AppTextarea = 'AppTextarea',
  AppToggle = 'AppToggle',
  RangeControl = 'RangeControl',
  TagInput = 'TagInput',
  Pagination = 'Pagination',
  DraggableList = 'DraggableList',
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
  [MountableComponent.AppButton]: {
    variant?: 'default' | 'danger' | 'confirm';
    icon?: string;
    disabled?: boolean;
    loading?: boolean;
    title?: string;
    onClick?: (event: MouseEvent) => void;
  };
  [MountableComponent.AppCheckbox]: {
    modelValue: boolean;
    label: string;
    description?: string;
    disabled?: boolean;
    'onUpdate:modelValue'?: (value: boolean) => void;
  };
  [MountableComponent.AppIcon]: {
    icon: string;
    spin?: boolean;
    fixedWidth?: boolean;
  };
  [MountableComponent.AppIconButton]: {
    icon: string;
    title?: string;
    active?: boolean;
    disabled?: boolean;
    variant?: 'default' | 'danger';
    onClick?: (event: MouseEvent) => void;
  };
  [MountableComponent.AppInput]: {
    modelValue: string | number;
    label?: string;
    type?: 'text' | 'number' | 'search' | 'password';
    placeholder?: string;
    disabled?: boolean;
    min?: number;
    max?: number;
    step?: number;
    'onUpdate:modelValue'?: (value: string | number) => void;
    onChange?: (event: Event) => void;
  };
  [MountableComponent.AppSelect]: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelValue: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: { label: string; value: any; disabled?: boolean }[];
    label?: string;
    disabled?: boolean;
    title?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'onUpdate:modelValue'?: (value: any) => void;
    onChange?: (event: Event) => void;
  };
  [MountableComponent.AppTextarea]: {
    modelValue: string;
    label?: string;
    placeholder?: string;
    rows?: number;
    disabled?: boolean;
    resizable?: boolean;
    'onUpdate:modelValue'?: (value: string) => void;
    onMaximize?: () => void;
  };
  [MountableComponent.AppToggle]: {
    modelValue: boolean;
    disabled?: boolean;
    'onUpdate:modelValue'?: (value: boolean) => void;
  };
  [MountableComponent.RangeControl]: {
    modelValue: number;
    min?: number;
    max?: number;
    step?: number;
    label?: string;
    disabled?: boolean;
    'onUpdate:modelValue'?: (value: number) => void;
  };
  [MountableComponent.TagInput]: {
    modelValue: string[];
    placeholder?: string;
    'onUpdate:modelValue'?: (value: string[]) => void;
  };
  [MountableComponent.Pagination]: {
    totalItems: number;
    currentPage: number;
    itemsPerPage: number;
    itemsPerPageOptions?: number[];
    'onUpdate:currentPage'?: (page: number) => void;
    'onUpdate:itemsPerPage'?: (size: number) => void;
  };
  [MountableComponent.DraggableList]: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: any[];
    itemKey?: string;
    handleClass?: string;
    disabled?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'onUpdate:items'?: (items: any[]) => void;
    onReorder?: (payload: { from: number; to: number }) => void;
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
      get: () => Readonly<ChatMetadata> | null;
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
    getActives: () => Readonly<Character[]>;
    getAll: () => readonly Character[];
    get: (avatar: string) => Readonly<Character> | null;
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
    updateEntry: (bookName: string, entry: WorldInfoEntry) => Promise<void>;
  };
  ui: {
    showToast: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
    openDrawer: (panelName: DrawerType) => void;
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
    ) => Promise<string>;

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
     * @returns An object containing an unmount function to clean up the component.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mount: (container: HTMLElement, component: Component, props?: Record<string, any>) => { unmount: () => void };
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
