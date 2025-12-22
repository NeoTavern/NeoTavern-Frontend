import type { Component } from 'vue';
import type { EventPriority } from '../constants';
import type { PromptBuilder } from '../services/prompt-engine';
import type { WorldInfoProcessor } from '../services/world-info';
import type { Character } from './character';
import type { ChatInfo, ChatMessage, ChatMetadata, FullChat } from './chat';
import type { DrawerType } from './common';
import type { ExtensionEventMap } from './events';
import type { ApiChatMessage, ChatCompletionPayload, GenerationResponse, StreamedChunk } from './generation';
import type { Persona, PersonaDescription } from './persona';
import type { PopupShowOptions } from './popup';
import type { ApiFormatter, CodeMirrorTarget, SamplerSettings, Settings, SettingsPath } from './settings';
import type { Path, ValueForPath } from './utils';
import type { WorldInfoBook, WorldInfoEntry, WorldInfoHeader, WorldInfoSettings } from './world-info';

export interface ChatInputDetail {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface LlmGenerationOptions {
  connectionProfileName?: string;
  formatter?: ApiFormatter;
  samplerOverrides?: Partial<SamplerSettings>;
  instructTemplateName?: string;
  signal?: AbortSignal;
  generationId?: string;
}

export interface TextareaToolDefinition {
  id: string;
  icon: string;
  title: string;
  onClick: (payload: { value: string; setValue: (val: string) => void }) => void;
}

export enum MountableComponent {
  ConnectionProfileSelector = 'ConnectionProfileSelector',
  Button = 'Button',
  Checkbox = 'Checkbox',
  FileInput = 'FileInput',
  FormItem = 'FormItem',
  Icon = 'Icon',
  ImageCropper = 'ImageCropper',
  Input = 'Input',
  ListItem = 'ListItem',
  MainContentFullscreenToggle = 'MainContentFullscreenToggle',
  PanelLayout = 'PanelLayout',
  PresetControl = 'PresetControl',
  Search = 'Search',
  Select = 'Select',
  SidebarHeader = 'SidebarHeader',
  Tabs = 'Tabs',
  Textarea = 'Textarea',
  TextareaExpanded = 'TextareaExpanded',
  Toggle = 'Toggle',
  CollapsibleSection = 'CollapsibleSection',
  RangeControl = 'RangeControl',
  TagInput = 'TagInput',
  Pagination = 'Pagination',
  DraggableList = 'DraggableList',
  DrawerHeader = 'DrawerHeader',
  EmptyState = 'EmptyState',
  SmartAvatar = 'SmartAvatar',
  SplitPane = 'SplitPane',
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
  [MountableComponent.Button]: {
    variant?: 'default' | 'danger' | 'confirm' | 'ghost';
    icon?: string;
    disabled?: boolean;
    loading?: boolean;
    title?: string;
    onClick?: (event: MouseEvent) => void;
  };
  [MountableComponent.ImageCropper]: {
    src: string;
    aspectRatio?: number;
  };
  [MountableComponent.MainContentFullscreenToggle]: Record<string, never>;
  [MountableComponent.PanelLayout]: {
    mode?: 'full' | 'main-only' | 'side-only';
    title: string;
    storageKey: string;
    initialWidth?: number;
    collapsed?: boolean;
    'onUpdate:collapsed'?: (val: boolean) => void;
  };
  [MountableComponent.PresetControl]: {
    modelValue?: string | number;
    options?: { label: string; value: string | number }[];
    searchable?: boolean;
    disabled?: boolean;
    loading?: boolean;
    createTitle?: string;
    editTitle?: string;
    deleteTitle?: string;
    importTitle?: string;
    exportTitle?: string;
    saveTitle?: string;
    allowCreate?: boolean;
    allowEdit?: boolean;
    allowDelete?: boolean;
    allowImport?: boolean;
    allowExport?: boolean;
    allowSave?: boolean;
    deleteVariant?: 'ghost' | 'danger';
    'onUpdate:modelValue'?: (value: string | number) => void;
    onCreate?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
    onImport?: () => void;
    onExport?: () => void;
    onSave?: () => void;
  };
  [MountableComponent.SidebarHeader]: {
    title?: string;
  };
  [MountableComponent.TextareaExpanded]: {
    popupId: string;
    value: string;
    label?: string;
    'onUpdate:value'?: (value: string) => void;
  };
  [MountableComponent.Checkbox]: {
    modelValue: boolean;
    label: string;
    description?: string;
    disabled?: boolean;
    'onUpdate:modelValue'?: (value: boolean) => void;
  };
  [MountableComponent.FileInput]: {
    accept?: string;
    multiple?: boolean;
    type?: 'icon' | 'button';
    icon?: string;
    label?: string;
    onChange?: (files: File[]) => void;
  };
  [MountableComponent.FormItem]: {
    label?: string;
    description?: string;
    error?: string;
    horizontal?: boolean;
  };
  [MountableComponent.Icon]: {
    icon: string;
    spin?: boolean;
    fixedWidth?: boolean;
  };
  [MountableComponent.Input]: {
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
  [MountableComponent.ListItem]: {
    active?: boolean;
    selected?: boolean;
  };
  [MountableComponent.Search]: {
    modelValue: string;
    placeholder?: string;
    'onUpdate:modelValue'?: (value: string) => void;
  };
  [MountableComponent.Select]: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelValue: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: { label: string; value: any; disabled?: boolean }[];
    label?: string;
    disabled?: boolean;
    title?: string;
    multiple?: boolean;
    placeholder?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'onUpdate:modelValue'?: (value: any) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange?: (value: any) => void;
  };
  [MountableComponent.Tabs]: {
    modelValue: string;
    options: { label: string; value: string; icon?: string }[];
    'onUpdate:modelValue'?: (value: string) => void;
  };
  [MountableComponent.Textarea]: {
    modelValue: string;
    label?: string;
    placeholder?: string;
    rows?: number;
    disabled?: boolean;
    resizable?: boolean;
    'onUpdate:modelValue'?: (value: string) => void;
    onMaximize?: () => void;
  };
  [MountableComponent.Toggle]: {
    modelValue: boolean;
    disabled?: boolean;
    'onUpdate:modelValue'?: (value: boolean) => void;
  };
  [MountableComponent.CollapsibleSection]: {
    title: string;
    isOpen?: boolean;
    subtitle?: string;
    'onUpdate:isOpen'?: (value: boolean) => void;
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
  [MountableComponent.DrawerHeader]: {
    title?: string;
  };
  [MountableComponent.EmptyState]: {
    icon?: string;
    title?: string;
    description?: string;
  };
  [MountableComponent.SmartAvatar]: {
    urls: string[];
    alt?: string;
  };
  [MountableComponent.SplitPane]: {
    storageKey?: string;
    initialWidth?: number;
    minWidth?: number;
    maxWidth?: number;
    collapsed?: boolean;
    side?: 'left' | 'right';
    'onUpdate:collapsed'?: (value: boolean) => void;
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

  /**
   * Generates a UUID v4 string.
   * @returns A RFC4122 version 4 UUID string.
   */
  uuid: () => string;

  chat: {
    sendMessage: (
      messageText: string,
      options?: { triggerGeneration?: boolean; generationId?: string },
    ) => Promise<void>;
    getHistory: () => ChatMessage[];
    /**
     * Retrieves the current active chat filename (without extension).
     * Returns null if no chat is loaded.
     */
    getChatInfo: () => ChatInfo | null;
    getAllChatInfos: () => Array<ChatInfo>;
    getLastMessage: () => ChatMessage | null;
    insertMessage: (message: Omit<ChatMessage, 'send_date'> & { send_date?: string }, index?: number) => void;
    updateMessage: (index: number, newContent: string, newReasoning?: string) => Promise<void>;
    updateMessageObject: (index: number, updates: Partial<ChatMessage>) => Promise<void>;
    deleteMessage: (index: number) => Promise<void>;
    regenerateResponse: (options?: { generationId?: string; forceSpeakerAvatar?: string }) => Promise<void>;
    continueResponse: (options?: { generationId?: string }) => Promise<void>;
    generateResponse: (options?: { generationId?: string; forceSpeakerAvatar?: string }) => Promise<void>;
    clear: () => Promise<void>;
    abortGeneration: () => void;
    getChatInput: () => ChatInputDetail | null;
    setChatInput: (value: string) => void;
    /**
     * Low-level generation method. Sends request directly to LLM Service.
     */
    generate: (
      payload: ChatCompletionPayload,
      formatter: ApiFormatter,
      signal?: AbortSignal,
    ) => Promise<GenerationResponse | (() => AsyncGenerator<StreamedChunk>)>;
    buildPayload: (messages: ApiChatMessage[], samplerOverrides?: Partial<SamplerSettings>) => ChatCompletionPayload;

    /**
     * Builds the prompt messages for the current active chat context, applying
     * world info, character definitions, persona, and history processing.
     * This replicates the internal prompt building logic used during generation.
     */
    buildPrompt: (options?: { generationId?: string; characterAvatar?: string }) => Promise<ApiChatMessage[]>;

    /**
     * Creates a new chat file with the provided content.
     * @param chat The full chat object (header + messages)
     * @param filename Optional filename (without extension). If not provided, a UUID will be generated.
     * @returns The filename of the created chat.
     */
    create: (chat: FullChat, filename?: string) => Promise<string>;

    /**
     * Loads a chat by its filename.
     * @param filename The filename of the chat to load (without extension).
     */
    load: (filename: string) => Promise<void>;

    metadata: {
      get: () => ChatMetadata | null;
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
    getGlobal: <P extends SettingsPath>(path: P) => ValueForPath<Settings, P>;

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
    getActives: () => Character[];
    getAll: () => Character[];
    get: (avatar: string) => Character | null;
    getEditing: () => Character | null;
    create: (character: Character, avatarImage?: File) => Promise<void>;
    delete: (avatar: string, deleteChats?: boolean) => Promise<void>;
    update: (avatar: string, data: Partial<Character>) => Promise<void>;
  };
  persona: {
    getActive: () => Persona | null;
    getAll: () => Persona[];
    setActive: (avatarId: string) => void;
    updateActiveField: <K extends keyof PersonaDescription>(field: K, value: PersonaDescription[K]) => Promise<void>;
    delete: (avatarId: string) => Promise<void>;
  };
  worldInfo: {
    getSettings: () => WorldInfoSettings;
    updateSettings: (settings: Partial<WorldInfoSettings>) => void;
    getAllBookNames: () => WorldInfoHeader[];
    getBook: (name: string) => Promise<WorldInfoBook | null>;
    getActiveBookNames: () => string[];
    setGlobalBookNames: (names: string[]) => void;
    updateEntry: (bookName: string, entry: WorldInfoEntry) => Promise<void>;
  };
  macro: {
    /**
     * Processes a string replacing macros (e.g. {{user}}, {{char}}) with context data.
     * @param text The text to process.
     * @param context Optional context overrides. If not provided, active context is used.
     * @param additionalMacros Optional custom macros to merge into the context. These can override built-in macros.
     */
    process: (
      text: string,
      context?: { activeCharacter?: Character; characters?: Character[]; persona?: Persona },
      additionalMacros?: Record<string, unknown>,
    ) => string;
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
      options?: { title?: string; icon?: string; props?: Record<string, any>; layoutId?: string },
    ) => Promise<string>;

    /**
     * Registers a custom item in the main navigation bar (and optional drawer).
     * @param id Unique identifier for the item.
     * @param options Configuration options.
     */
    registerNavBarItem: (
      id: string,
      options: {
        icon: string;
        title: string;
        component?: Component | null;
        onClick?: () => void;
        layout?: 'default' | 'wide';
        section?: 'main' | 'floating' | 'drawer';
        layoutComponent?: Component | null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        layoutProps?: Record<string, any>;
        defaultSidebarId?: string;
        targetSidebarId?: string;
      },
    ) => Promise<string>;

    /**
     * Unregisters a custom item from the main navigation bar.
     * @param id Unique identifier for the item.
     */
    unregisterNavBarItem: (id: string) => void;

    /**
     * Opens a specific sidebar view.
     * @param id The ID of the sidebar to open.
     */
    openSidebar: (id: string) => void;

    /**
     * Registers a tool action for Textareas with specific identifiers.
     * @param identifier The CodeMirrorTarget identifier (e.g. 'character.description').
     * @param definition The tool definition including icon and callback.
     * @returns A cleanup function to unregister the tool.
     */
    registerTextareaTool: (identifier: CodeMirrorTarget, definition: TextareaToolDefinition) => () => void;

    /**
     * Registers a custom tab in the Chat Management sidebar.
     * @param id Unique identifier for the tab.
     * @param title Title of the tab.
     * @param component The Vue component to render content.
     * @returns A cleanup function to unregister the tab.
     */
    registerChatSettingsTab: (id: string, title: string, component: Component) => () => void;

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
