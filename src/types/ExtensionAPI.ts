import type { Component } from 'vue';
import type { StrictT } from '../composables/useStrictI18n';
import type { EventPriority, GenerationMode } from '../constants';
import type { PromptBuilder } from '../services/prompt-engine';
import type { WorldInfoProcessor } from '../services/world-info';
import type { Character } from './character';
import type { ChatInfo, ChatMessage, ChatMetadata, FullChat } from './chat';
import type { DrawerType } from './common';
import type { ExtensionEventMap } from './events';
import type {
  ApiChatMessage,
  ChatCompletionPayload,
  GenerationResponse,
  ItemizedPrompt,
  MediaHydrationContext,
  PromptBuilderOptions,
  StreamedChunk,
  StructuredResponseOptions,
  ToolGenerationConfig,
} from './generation';
import type { Persona, PersonaDescription } from './persona';
import type { PopupShowOptions } from './popup';
import type { ApiFormatter, CodeMirrorTarget, SamplerSettings, Settings, SettingsPath } from './settings';
import type { ToolDefinition } from './tools';
import type { DeepPartial, Path, ValueForPath } from './utils';
import type { WorldInfoBook, WorldInfoEntry, WorldInfoHeader, WorldInfoSettings } from './world-info';

export interface ChatInputDetail {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface LlmGenerationOptions {
  connectionProfile?: string;
  formatter?: ApiFormatter;
  samplerOverrides?: Partial<SamplerSettings>;
  instructTemplateName?: string;
  signal?: AbortSignal;
  generationId?: string;
  /**
   * Identity of the requester.
   * Automatically populated for extensions using the scoped API.
   * Defaults to 'unknown' if not provided.
   */
  source?: string;
  /**
   * Configuration for structured response generation.
   */
  structuredResponse?: StructuredResponseOptions;
  /**
   * Configuration for tool calling.
   */
  toolConfig?: ToolGenerationConfig;
  isContinuation?: boolean;
  onCompletion?: (data: {
    outputTokens: number;
    duration: number;
    structured_content?: object;
    parse_error?: Error;
  }) => void;
}

export interface TextareaToolDefinition {
  id: string;
  icon: string;
  title: string;
  variant?: 'default' | 'danger' | 'confirm' | 'ghost';
  active?: boolean;
  onClick: (payload: { value: string; setValue: (val: string) => void }) => void;
}

export interface ChatFormOptionsMenuItemDefinition {
  id: string;
  icon: string;
  label: string;
  onClick: (event: Event) => void;
  separator?: 'before' | 'after';
  disabled?: boolean;
  title?: string;
  visible?: boolean;
  opensPopover?: string; // TODO: I'm not sure how to make this for extensions except a generic popover store, which I don't wanna create it.
}

export interface ChatQuickActionDefinition {
  id: string;
  icon: string;
  label?: string;
  onClick: (event: Event) => void;
  disabled?: boolean;
  title?: string;
  visible?: boolean;
  opensPopover?: string; // TODO: I'm not sure how to make this for extensions except a generic popover store, which I don't wanna create it.
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
    active?: boolean;
    role?: string;
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
    language?: 'markdown' | 'css';
    codeMirror?: boolean;
    'onUpdate:value'?: (value: string) => void;
  };
  [MountableComponent.Checkbox]: {
    modelValue: boolean;
    label: string;
    description?: string;
    disabled?: boolean;
    id?: string;
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
    for?: string;
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
    id?: string;
    tools?: TextareaToolDefinition[];
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
    label?: string;
    'onUpdate:modelValue'?: (value: string) => void;
  };
  [MountableComponent.Select]: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelValue: any;
    options: (// eslint-disable-next-line @typescript-eslint/no-explicit-any
    | { label: string; value: any; disabled?: boolean }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | { label: string; options: { label: string; value: any; disabled?: boolean }[] }
    )[];
    label?: string;
    disabled?: boolean;
    title?: string;
    multiple?: boolean;
    placeholder?: string;
    searchable?: boolean;
    groupSelect?: boolean;
    id?: string;
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
    allowMaximize?: boolean;
    codeMirror?: boolean;
    language?: 'markdown' | 'css';
    identifier?: string;
    id?: string;
    tools?: TextareaToolDefinition[];
    'onUpdate:modelValue'?: (value: string) => void;
    onMaximize?: () => void;
  };
  [MountableComponent.Toggle]: {
    modelValue: boolean;
    disabled?: boolean;
    title?: string;
    label?: string;
    id?: string;
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
    title?: string;
    id?: string;
    'onUpdate:modelValue'?: (value: number) => void;
  };
  [MountableComponent.TagInput]: {
    modelValue: string[];
    placeholder?: string;
    label?: string;
    suggestions?: string[];
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

export type TypedChatMessage<T = Record<string, unknown>> = Omit<ChatMessage, 'extra'> & {
  /**
   * Extension specific message data.
   * Intersects the standard fields (reasoning, tokens, etc) with the strictly-typed generic T.
   */
  extra: ChatMessage['extra'] & T;
};

export interface ExtensionAPI<
  TSettings = Record<string, unknown>,
  TChatExtra = Record<string, unknown>,
  TMessageExtra = Record<string, unknown>,
> {
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
    getHistory: () => TypedChatMessage<TMessageExtra>[];
    /**
     * Retrieves the current active chat filename (without extension).
     * Returns null if no chat is loaded.
     */
    getChatInfo: () => ChatInfo<TChatExtra> | null;
    getAllChatInfos: () => Array<ChatInfo<TChatExtra>>;
    getLastMessage: () => TypedChatMessage<TMessageExtra> | null;
    createMessage: (message: ApiChatMessage) => Promise<TypedChatMessage<TMessageExtra>>;
    insertMessage: (
      message: Omit<TypedChatMessage<TMessageExtra>, 'send_date'> & { send_date?: string },
      index?: number,
    ) => Promise<void>;
    updateMessage: (index: number, newContent: string, newReasoning?: string) => Promise<void>;
    updateMessageObject: (index: number, updates: DeepPartial<TypedChatMessage<TMessageExtra>>) => Promise<void>;
    deleteMessage: (index: number) => Promise<void>;
    generateResponse: (
      initialMode: GenerationMode,
      options?: { generationId?: string; forceSpeakerAvatar?: string },
    ) => Promise<void>;
    clear: () => Promise<void>;
    abortGeneration: () => void;
    setGeneratingState: (generating: boolean) => void;
    getChatInput: () => ChatInputDetail | null;
    setChatInput: (value: string) => void;
    /**
     * Focuses the chat input element (works with both textarea and CodeMirror).
     */
    focusChatInput: () => void;
    /**
     * Low-level generation method. Sends request directly to LLM Service.
     */
    generate: (
      payload: ChatCompletionPayload,
      formatter: ApiFormatter,
      signal?: AbortSignal,
    ) => Promise<GenerationResponse | AsyncGenerator<StreamedChunk>>;
    buildPayload: (messages: ApiChatMessage[], samplerOverrides?: Partial<SamplerSettings>) => ChatCompletionPayload;

    /**
     * Builds the prompt messages for the current active chat context, applying
     * world info, character definitions, persona, and history processing.
     * This replicates the internal prompt building logic used during generation.
     */
    buildPrompt: (
      options?: Partial<Omit<PromptBuilderOptions, 'samplerSettings' | 'worldInfo' | 'mediaContext'>> & {
        samplerSettings?: Partial<SamplerSettings>;
        worldInfo?: Partial<WorldInfoSettings>;
        mediaContext?: Partial<MediaHydrationContext>;
        generationId?: string;
        messageIndex?: number;
        swipeId?: number;
      },
    ) => Promise<ItemizedPrompt>;

    /**
     * Creates a new chat file with the provided content.
     * @param chat The full chat object (header + messages)
     * @param filename Optional filename (without extension). If not provided, a UUID will be generated.
     * @returns The filename of the created chat.
     */
    create: (chat: FullChat<TChatExtra>, filename?: string) => Promise<string>;

    /**
     * Loads a chat by its filename.
     * @param filename The filename of the chat to load (without extension).
     */
    load: (filename: string) => Promise<void>;

    /**
     * Adds an itemized prompt to the prompt store for tracking and analysis.
     * @param prompt The itemized prompt to add.
     */
    addItemizedPrompt: (prompt: ItemizedPrompt) => void;

    metadata: {
      get: () => ChatMetadata<TChatExtra> | null;
      set: (metadata: ChatMetadata<TChatExtra>) => void;
      update: (updates: DeepPartial<ChatMetadata<TChatExtra>>) => void;
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
    createDefaultEntry(uid: number): WorldInfoEntry;
    getNewUid(book: WorldInfoBook): number;
    getSettings: () => WorldInfoSettings;
    updateSettings: (settings: Partial<WorldInfoSettings>) => void;
    getAllBookNames: () => WorldInfoHeader[];
    getBook: (name: string) => Promise<WorldInfoBook | null>;
    getActiveBookNames: () => string[];
    setGlobalBookNames: (names: string[]) => void;
    createEntry: (bookName: string, entry: WorldInfoEntry) => Promise<void>;
    updateEntry: (bookName: string, entry: WorldInfoEntry) => Promise<void>;
    deleteEntry: (bookName: string, uid: number) => Promise<void>;
    getSelectedBookName: () => string | null;
    getSelectedEntry: () => { bookName: string; entry: WorldInfoEntry } | null;
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
  tools: {
    /**
     * Registers a new tool.
     * @param tool The tool definition to register.
     */
    register: (tool: ToolDefinition) => Promise<void>;
    /**
     * Unregisters a tool by name.
     * @param name The name of the tool to unregister.
     */
    unregister: (name: string) => Promise<void>;
    /**
     * Gets a tool by name.
     * @param name The name of the tool.
     * @returns The tool definition or undefined if not found.
     */
    get: (name: string) => ToolDefinition | undefined;
    /**
     * Gets all registered tools.
     * @returns Array of all tool definitions.
     */
    getAll: () => ToolDefinition[];
    /**
     * Gets all enabled tools.
     * @returns Array of enabled tool definitions.
     */
    getEnabled: () => ToolDefinition[];
    /**
     * Checks if a tool is disabled.
     * @param name The name of the tool.
     * @returns True if the tool is disabled.
     */
    isDisabled: (name: string) => boolean;
    /**
     * Toggles the enabled state of a tool.
     * @param name The name of the tool.
     * @param enable Optional: set to true to enable, false to disable, undefined to toggle.
     */
    toggle: (name: string, enable?: boolean) => void;
  };
  ui: {
    /**
     * Checks if the device is a mobile device (phone/tablet) based on user agent.
     */
    isDeviceMobile: () => boolean;
    /**
     * Checks if the UI is in mobile mode (narrow viewport).
     * This respects the 'Force Mobile Mode' setting.
     */
    isMobile: () => boolean;
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

    unregisterSidebar: (id: string, side: 'left' | 'right') => void;

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
     * Activates a navbar item (switches layout or toggles sidebar).
     * @param id The ID of the navbar item to activate.
     */
    activateNavBarItem: (id: string) => void;

    /**
     * Automatically closes sidebars on mobile devices.
     */
    autoCloseSidebarsOnMobile: () => void;

    /**
     * Selects a character for editing in the character panel.
     * @param avatar The avatar ID of the character to edit.
     */
    selectCharacterForEditing: (avatar: string) => void;

    /**
     * Registers a tool action for Textareas with specific identifiers.
     * @param identifier The CodeMirrorTarget identifier (e.g. 'character.description') or a RegExp pattern.
     * @param definition The tool definition including icon and callback.
     * @returns A cleanup function to unregister the tool.
     */
    registerTextareaTool: (
      identifier: CodeMirrorTarget | string | RegExp,
      definition: TextareaToolDefinition,
    ) => () => void;

    unregisterTextareaTool: (identifier: CodeMirrorTarget | string | RegExp, toolId: string) => void;

    /**
     * Registers an item in the chat form's options menu (three-bar icon).
     * @param item The menu item definition. The ID will be namespaced to the extension.
     * @returns A cleanup function to unregister the item.
     */
    registerChatFormOptionsMenuItem: (item: ChatFormOptionsMenuItemDefinition) => () => void;

    unregisterChatFormOptionsMenuItem: (itemId: string) => void;

    /**
     * Registers a button in the chat's "Quick Actions" bar.
     * @param groupId A unique ID for the group this action belongs to (e.g., 'memory', 'rewrite'). If the group doesn't exist, it will be created with the provided label.
     * @param groupLabel The display name for the group (only used when creating it for the first time).
     * @param action The action button definition. The ID will be namespaced to the extension.
     * @returns A cleanup function to unregister the action.
     */
    registerChatQuickAction: (groupId: string, groupLabel: string, action: ChatQuickActionDefinition) => () => void;

    unregisterChatQuickAction: (groupId: string, actionId: string) => void;

    /**
     * Registers a custom tab in the Chat Management sidebar.
     * @param id Unique identifier for the tab.
     * @param title Title of the tab.
     * @param component The Vue component to render content.
     * @returns A cleanup function to unregister the tab.
     */
    registerChatSettingsTab: (id: string, title: string, component: Component) => () => void;

    unregisterChatSettingsTab: (tabId: string) => void;

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
    ) => Promise<GenerationResponse | AsyncGenerator<StreamedChunk>>;
  };

  i18n: {
    t: StrictT;
  };
}
