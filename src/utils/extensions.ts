import * as Vue from 'vue';
import { createVNode, nextTick, render, type App } from 'vue';
import { CustomPromptPostProcessing, default_avatar, default_user_avatar } from '../constants';
import type {
  ApiChatContentPart,
  ApiChatMessage,
  Character,
  ChatInfo,
  ChatMessage,
  ExtensionAPI,
  ExtensionEventMap,
  ExtensionMetadata,
  ItemizedPrompt,
  MediaHydrationContext,
  MountableComponent,
  PromptTokenBreakdown,
  SettingsPath,
  Tokenizer,
  WorldInfoBook,
} from '../types';
import { isDeviceMobile, isViewportMobile, sanitizeSelector } from './client';
import { formatFileSize, getMessageTimeStamp, uuidv4 } from './commons';

// Internal Store Imports
import {
  ChatCompletionService,
  buildChatCompletionPayload,
  processMessagesWithPrefill,
  resolveConnectionProfileSettings,
} from '../api/generation';
import { toast } from '../composables/useToast';
import { chatService } from '../services/chat.service';
import { useApiStore } from '../stores/api.store';
import { useCharacterStore } from '../stores/character.store';
import { useChatUiStore } from '../stores/chat-ui.store';
import { useChatStore } from '../stores/chat.store';
import { getExtensionContainerId } from '../stores/extension.store';
import { usePersonaStore } from '../stores/persona.store';
import { usePopupStore } from '../stores/popup.store';
import { usePromptStore } from '../stores/prompt.store';
import { useSettingsStore } from '../stores/settings.store';
import { useUiStore } from '../stores/ui.store';
import { useWorldInfoStore } from '../stores/world-info.store';

// Service Imports
import { ApiTokenizer } from '../api/tokenizer';
import VanillaSidebar from '../components/Shared/VanillaSidebar.vue';
import i18n from '../i18n';
import { macroService } from '../services/macro-service';
import { PromptBuilder } from '../services/prompt-engine';
import { WorldInfoProcessor, createDefaultEntry } from '../services/world-info';
import { useCharacterUiStore } from '../stores/character-ui.store';
import { useComponentRegistryStore } from '../stores/component-registry.store';
import { useLayoutStore } from '../stores/layout.store';
import { useToolStore } from '../stores/tool.store';
import { useWorldInfoUiStore } from '../stores/world-info-ui.store';
import type { LlmGenerationOptions } from '../types/ExtensionAPI';

/**
 * A centralized utility to count tokens for message content (string or array of parts).
 * This correctly handles both simple string content and complex content with text and media.
 * @param content The content to tokenize.
 * @param tokenizer The tokenizer instance to use.
 * @returns The number of tokens in the text parts of the content.
 */
export async function countTokens(
  content: string | ApiChatContentPart[] | unknown,
  tokenizer: Tokenizer,
): Promise<number> {
  if (typeof content === 'string') {
    return await tokenizer.getTokenCount(content);
  }

  if (Array.isArray(content)) {
    // It's an array of content parts (e.g. text and images), count only text parts.
    const textContent = content
      .filter((part): part is ApiChatContentPart & { type: 'text' } => part.type === 'text')
      .map((part) => part.text || '')
      .join('');
    return await tokenizer.getTokenCount(textContent);
  }

  return 0;
}

// --- Event Emitter ---

import { getModelCapabilities } from '../api/provider-definitions';
import { getThumbnailUrl } from './character';
import { mergeWithUndefinedMulti } from './commons';
import { eventEmitter } from './event-emitter';
export { eventEmitter };

// --- Loader Utils ---

const loadedModules = new Set<string>();

export function loadScript(name: string, jsFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `/extensions/${name}/${jsFile}`;
    const id = sanitizeSelector(`${name}-js`);

    if (loadedModules.has(url) || document.getElementById(id)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.id = id;
    script.type = 'module';
    script.src = url;
    script.async = true;
    script.onload = () => {
      loadedModules.add(url);
      resolve();
    };
    script.onerror = (err) => reject(err);
    document.body.appendChild(script);
  });
}

export function unloadScript(name: string) {
  const id = sanitizeSelector(`${name}-js`);
  const script = document.getElementById(id);
  if (script) script.remove();
  for (const url of loadedModules) {
    if (url.includes(`/extensions/${name}/`)) {
      loadedModules.delete(url);
    }
  }
}

export function loadStyle(name: string, cssFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `/extensions/${name}/${cssFile}`;
    const id = sanitizeSelector(`${name}-css`);
    if (document.getElementById(id)) {
      resolve();
      return;
    }
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = url;
    link.onload = () => resolve();
    link.onerror = (err) => reject(err);
    document.head.appendChild(link);
  });
}

export function unloadStyle(name: string) {
  const id = sanitizeSelector(`${name}-css`);
  const link = document.getElementById(id);
  if (link) link.remove();
}

// --- API Implementation ---

function deepClone<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj)) as T;
}

const mountableComponents: Record<MountableComponent, () => Promise<{ default: Vue.Component }>> = {
  ConnectionProfileSelector: () => import('../components/common/ConnectionProfileSelector.vue'),
  Button: () => import('../components/UI/Button.vue'),
  Checkbox: () => import('../components/UI/Checkbox.vue'),
  FileInput: () => import('../components/UI/FileInput.vue'),
  FormItem: () => import('../components/UI/FormItem.vue'),
  Icon: () => import('../components/UI/Icon.vue'),
  ImageCropper: () => import('../components/UI/ImageCropper.vue'),
  Input: () => import('../components/UI/Input.vue'),
  ListItem: () => import('../components/UI/ListItem.vue'),
  MainContentFullscreenToggle: () => import('../components/common/MainContentFullscreenToggle.vue'),
  PanelLayout: () => import('../components/common/PanelLayout.vue'),
  PresetControl: () => import('../components/common/PresetControl.vue'),
  Search: () => import('../components/UI/Search.vue'),
  Select: () => import('../components/UI/Select.vue'),
  SidebarHeader: () => import('../components/common/SidebarHeader.vue'),
  Tabs: () => import('../components/UI/Tabs.vue'),
  Textarea: () => import('../components/UI/Textarea.vue'),
  TextareaExpanded: () => import('../components/UI/TextareaExpanded.vue'),
  Toggle: () => import('../components/UI/Toggle.vue'),
  CollapsibleSection: () => import('../components/UI/CollapsibleSection.vue'),
  RangeControl: () => import('../components/UI/RangeControl.vue'),
  TagInput: () => import('../components/UI/TagInput.vue'),
  Pagination: () => import('../components/common/Pagination.vue'),
  DraggableList: () => import('../components/common/DraggableList.vue'),
  DrawerHeader: () => import('../components/common/DrawerHeader.vue'),
  EmptyState: () => import('../components/common/EmptyState.vue'),
  SmartAvatar: () => import('../components/common/SmartAvatar.vue'),
  SplitPane: () => import('../components/common/SplitPane.vue'),
};

let mainAppInstance: App | null = null;
export function setMainAppInstance(app: App) {
  mainAppInstance = app;
}

const extensionCleanupRegistry = new Map<string, () => void>();
export function disposeExtension(extensionId: string) {
  const cleanup = extensionCleanupRegistry.get(extensionId);
  if (cleanup) {
    cleanup();
    extensionCleanupRegistry.delete(extensionId);
  }
}

const baseExtensionAPI: ExtensionAPI = {
  meta: { id: '', containerId: '' },
  uuid: () => uuidv4(),
  chat: {
    sendMessage: async (messageText, options) => {
      await useChatStore().sendMessage(messageText, {
        triggerGeneration: options?.triggerGeneration ?? true,
        generationId: options?.generationId,
      });
    },
    getHistory: () => {
      const store = useChatStore();
      if (!store.activeChat) throw new Error('No active chat.');
      return deepClone(store.activeChat.messages);
    },
    getChatInfo: () => {
      const store = useChatStore();
      return deepClone(
        store.activeChatFile ? store.chatInfos.find((info) => info.file_id === store.activeChatFile) || null : null,
      );
    },
    getAllChatInfos: () => {
      return deepClone(useChatStore().chatInfos);
    },
    getLastMessage: () => {
      const messages = useChatStore().activeChat?.messages ?? [];
      return messages.length > 0 ? deepClone(messages[messages.length - 1]) : null;
    },
    createMessage: async (message: ApiChatMessage) => {
      if (!message.content) {
        throw new Error('Message content cannot be empty.');
      }
      let content: string = '';
      if (Array.isArray(message.content)) {
        const anyNonText = message.content.find((part) => part.type !== 'text');
        if (anyNonText) {
          throw new Error('Cannot create message with non-text content parts.');
        }
        content = message.content.map((part) => part.text).join('');
      } else if (typeof message.content === 'string') {
        content = message.content;
      } else {
        throw new Error('Invalid message content format.');
      }
      const chatStore = useChatStore();
      if (!chatStore.activeChat) {
        throw new Error('No active chat.');
      }
      const personaStore = usePersonaStore();
      const characterStore = useCharacterStore();
      const activeCharacter = characterStore.activeCharacters[0];
      if (!activeCharacter) {
        throw new Error('No active character.');
      }
      const activePersona = personaStore.activePersona;
      if (!activePersona) {
        throw new Error('No active persona.');
      }
      const now = getMessageTimeStamp();
      const fullMessage: ChatMessage = {
        is_user: message.role === 'user',
        is_system: false,
        mes: content,
        name: message.name,
        send_date: now,
        original_avatar:
          message.role === 'system'
            ? 'system'
            : message.role === 'user'
              ? activePersona.avatarId
              : activeCharacter.avatar,
        force_avatar:
          message.role === 'system'
            ? 'favicon.ico'
            : message.role === 'user'
              ? getThumbnailUrl('persona', activePersona.avatarId || default_user_avatar)
              : undefined,
        extra: {},
        swipe_id: 0,
        swipe_info: [
          {
            extra: {},
            send_date: now,
          },
        ],
        swipes: [content],
      };
      chatStore.activeChat.messages.push(fullMessage);
      await nextTick();
      await eventEmitter.emit('message:created', fullMessage);
      return deepClone(fullMessage);
    },
    insertMessage: async (message, index) => {
      const store = useChatStore();
      if (!store.activeChat) throw new Error('No active chat.');
      const fullMessage: ChatMessage = { ...message, send_date: message.send_date ?? getMessageTimeStamp() };
      const messages = store.activeChat.messages;
      if (index === undefined || index < 0 || index >= messages.length) {
        messages.push(fullMessage);
      } else {
        messages.splice(index, 0, fullMessage);
      }
      await nextTick();
      await eventEmitter.emit('message:created', fullMessage);
    },
    updateMessage: async (index, newContent, newReasoning) => {
      const store = useChatStore();
      store.startEditing(index);
      await store.saveMessageEdit(newContent, newReasoning);
    },
    updateMessageObject: async (index, updates) => {
      return await useChatStore().updateMessageObject(index, updates);
    },
    deleteMessage: async (index) => {
      await useChatStore().deleteMessage(index);
    },
    generateResponse: async (initialMode, options) => {
      return await useChatStore().generateResponse(initialMode, options);
    },
    clear: async () => {
      return await useChatStore().clearChat(true);
    },
    abortGeneration: () => {
      useChatStore().abortGeneration();
    },
    setGeneratingState: (generating: boolean) => {
      useChatStore().setGeneratingState(generating);
    },
    getChatInput: () => {
      const el = useChatUiStore().chatInputElement;
      if (!el) return null;
      return {
        value: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
      };
    },
    setChatInput: (value: string) => {
      const el = useChatUiStore().chatInputElement;
      if (el) {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    focusChatInput: () => {
      const el = document.getElementById('chat-input');
      if (el) {
        const textarea = el.tagName === 'TEXTAREA' ? (el as HTMLTextAreaElement) : el.querySelector('textarea');
        if (textarea instanceof HTMLTextAreaElement) {
          textarea.focus();
        }
      }
    },
    generate: async (payload, formatter, signal) => {
      return await ChatCompletionService.generate(payload, formatter, { signal });
    },
    buildPayload: (messages, samplerOverrides) => {
      const settingsStore = useSettingsStore();
      const apiStore = useApiStore();
      const uiStore = useUiStore();
      if (!apiStore.activeModel) throw new Error('No active model selected.');

      return buildChatCompletionPayload({
        samplerSettings: { ...settingsStore.settings.api.samplers, ...samplerOverrides },
        messages,
        model: apiStore.activeModel,
        provider: settingsStore.settings.api.provider,
        providerSpecific: settingsStore.settings.api.providerSpecific,
        customPromptPostProcessing: settingsStore.settings.api.customPromptPostProcessing,
        playerName: uiStore.activePlayerName || 'User',
        modelList: apiStore.modelList,
      });
    },
    buildPrompt: async (options) => {
      const chatStore = useChatStore();
      const characterStore = useCharacterStore();
      const settingsStore = useSettingsStore();
      const worldInfoStore = useWorldInfoStore();
      const personaStore = usePersonaStore();
      const apiStore = useApiStore();

      if (!options?.chatHistory && !chatStore.activeChat) throw new Error('No active chat.');
      if (!options?.persona && !personaStore.activePersona) throw new Error('No active persona.');

      const chatHistory = options?.chatHistory ?? [...(chatStore.activeChat?.messages ?? [])];
      const chatMetadata = options?.chatMetadata ?? chatStore.activeChat?.metadata;
      const persona = options?.persona ?? personaStore.activePersona;
      if (chatHistory.length === 0) throw new Error('Chat history is empty.');
      if (!persona) throw new Error('No active persona.');

      // Determine the character context
      let contextCharacters: Character[] = options?.characters || [];

      if (!options?.characters) {
        const activeCharacter =
          characterStore.activeCharacters.length > 0 ? characterStore.activeCharacters[0] : undefined;
        if (activeCharacter) {
          contextCharacters = [activeCharacter];

          await eventEmitter.emit(
            'generation:resolve-context',
            { characters: contextCharacters },
            { generationId: options?.generationId },
          );
        }
      }

      const tokenizer =
        options?.tokenizer ??
        new ApiTokenizer({
          tokenizerType: settingsStore.settings.api.tokenizer,
          model: apiStore.activeModel,
        });

      let books: WorldInfoBook[] = options?.books || [];
      if (!options?.books) {
        books = (
          await Promise.all(
            worldInfoStore.activeBookNames.map(async (name) => await worldInfoStore.getBookFromCache(name, true)),
          )
        ).filter((book): book is WorldInfoBook => book !== undefined);
      }

      const mediaContext: MediaHydrationContext = mergeWithUndefinedMulti(
        {},
        {
          apiSettings: {
            forbidExternalMedia: settingsStore.settings.ui.chat.forbidExternalMedia,
            imageQuality: settingsStore.settings.api.imageQuality,
            sendMedia: settingsStore.settings.api.sendMedia,
          },
          formatter: settingsStore.settings.api.formatter,
          modelCapabilities: getModelCapabilities(
            settingsStore.settings.api.provider,
            apiStore.activeModel,
            apiStore.modelList,
          ),
        } satisfies MediaHydrationContext,
        options?.mediaContext,
      );

      const builder = new PromptBuilder({
        generationId: options?.generationId ?? uuidv4(),
        characters: contextCharacters,
        chatMetadata,
        chatHistory,
        persona,
        samplerSettings: mergeWithUndefinedMulti({}, settingsStore.settings.api.samplers, options?.samplerSettings),
        tokenizer,
        books,
        worldInfo: mergeWithUndefinedMulti({}, settingsStore.settings.worldInfo, options?.worldInfo),
        mediaContext,
        structuredResponse: options?.structuredResponse,
      });

      const messages = await builder.build();

      // Calculate token breakdown similar to core generation
      const promptTotalText = await Promise.all(
        messages.map(async (m) => await countTokens(m.content, tokenizer)),
      ).then((counts) => counts.reduce((a, b) => a + b, 0));
      const promptTotal = promptTotalText + builder.mediaTokenCost;

      const processedWorldInfo = builder.processedWorldInfo;
      let wiTokens = 0;
      if (processedWorldInfo) {
        const parts = [
          processedWorldInfo.worldInfoBefore,
          processedWorldInfo.worldInfoAfter,
          ...processedWorldInfo.anBefore,
          ...processedWorldInfo.anAfter,
          ...processedWorldInfo.emBefore,
          ...processedWorldInfo.emAfter,
          ...processedWorldInfo.depthEntries.flatMap((d) => d.entries),
          ...Object.values(processedWorldInfo.outletEntries).flat(),
        ];
        const fullWiText = parts.filter(Boolean).join('\n');
        if (fullWiText) wiTokens = await countTokens(fullWiText, tokenizer);
      }

      const charDesc =
        contextCharacters.length > 0 ? await countTokens(contextCharacters[0].description || '', tokenizer) : 0;
      const charPers =
        contextCharacters.length > 0 ? await countTokens(contextCharacters[0].personality || '', tokenizer) : 0;
      const charScen =
        contextCharacters.length > 0 ? await countTokens(contextCharacters[0].scenario || '', tokenizer) : 0;
      const charEx =
        contextCharacters.length > 0 ? await countTokens(contextCharacters[0].mes_example || '', tokenizer) : 0;
      const personaDesc = await countTokens(persona.description || '', tokenizer);

      const breakdown: PromptTokenBreakdown = {
        systemTotal: 0,
        description: charDesc,
        personality: charPers,
        scenario: charScen,
        examples: charEx,
        persona: personaDesc,
        worldInfo: wiTokens,
        chatHistory: 0,
        extensions: 0,
        bias: 0,
        promptTotal: promptTotal,
        maxContext: builder.maxContext,
        padding: builder.maxContext - promptTotal - builder.samplerSettings.max_tokens,
      };

      for (const m of messages) {
        const count = await countTokens(m.content, tokenizer);
        if (m.role === 'system') breakdown.systemTotal += count;
        else breakdown.chatHistory += count;
      }
      breakdown.chatHistory += builder.mediaTokenCost;

      const itemizedPrompt: ItemizedPrompt = {
        generationId: builder.generationId,
        messageIndex: options?.messageIndex ?? 0,
        swipeId: options?.swipeId ?? 0,
        model: apiStore.activeModel,
        api: settingsStore.settings.api.provider,
        tokenizer: settingsStore.settings.api.tokenizer,
        presetName: chatMetadata?.connection_profile || settingsStore.settings.api.selectedSampler || 'Default',
        messages,
        breakdown,
        timestamp: Date.now(),
        worldInfoEntries: processedWorldInfo?.triggeredEntries ?? {},
      };

      return itemizedPrompt;
    },
    create: async (chat, filename) => {
      const chatStore = useChatStore();
      const finalFilename = filename || uuidv4();
      await chatService.create(finalFilename, chat);

      const header = chat[0];
      const messages = chat.slice(1) as ChatMessage[];
      const last = messages[messages.length - 1];

      // Update store lists manually to avoid full refresh
      const info: ChatInfo = {
        chat_metadata: header.chat_metadata,
        chat_items: messages.length,
        file_id: finalFilename,
        file_name: `${finalFilename}.jsonl`,
        file_size: formatFileSize(JSON.stringify(chat).length),
        last_mes: getMessageTimeStamp(),
        mes: last?.mes || '',
      };

      chatStore.chatInfos.unshift(info);

      return finalFilename;
    },
    load: async (filename) => {
      await useChatStore().setActiveChatFile(filename);
    },
    metadata: {
      get: () => deepClone(useChatStore().activeChat?.metadata ?? null),
      set: (metadata) => {
        const store = useChatStore();
        if (store.activeChat) {
          store.activeChat.metadata = metadata;
          const chatInfo = store.chatInfos.find((info) => info.file_id === store.activeChatFile);
          if (chatInfo) {
            chatInfo.chat_metadata = metadata;
          }
          store.triggerSave();
        }
      },
      update: (updates) => {
        const store = useChatStore();
        if (store.activeChat) {
          store.activeChat.metadata = mergeWithUndefinedMulti({}, store.activeChat.metadata, updates);
          const chatInfo = store.chatInfos.find((info) => info.file_id === store.activeChatFile);
          if (chatInfo) {
            chatInfo.chat_metadata = store.activeChat.metadata;
          }
          store.triggerSave();
        }
      },
    },
    addItemizedPrompt: (prompt) => {
      usePromptStore().addItemizedPrompt(prompt);
    },
    PromptBuilder,
    WorldInfoProcessor,
  },
  settings: {
    // @ts-expect-error it should return T
    get: () => console.warn('[ExtensionAPI] Scoped settings.get called via base API.'),
    getGlobal: (path) => deepClone(useSettingsStore().getSetting(path)),
    set: () => console.warn('[ExtensionAPI] Scoped settings.set called via base API.'),
    setGlobal: (path, value) => useSettingsStore().setSetting(path, value),
    save: () => useSettingsStore().saveSettingsDebounced(),
  },
  character: {
    getActives: () => deepClone(useCharacterStore().activeCharacters),
    getAll: () => deepClone(useCharacterStore().characters),
    get: (avatar) => {
      const char = useCharacterStore().characters.find((c) => c.avatar === avatar);
      return char ? deepClone(char) : null;
    },
    getEditing: () => deepClone(useCharacterUiStore().editFormCharacter),
    create: async (character, avatarImage) => {
      const store = useCharacterStore();
      if (!avatarImage) {
        const res = await fetch(default_avatar);
        const blob = await res.blob();
        avatarImage = new File([blob], 'avatar.png', { type: 'image/png' });
      }
      await store.createNewCharacter(character, avatarImage);
    },
    delete: async (avatar, deleteChats) => useCharacterStore().deleteCharacter(avatar, deleteChats ?? false),
    update: async (avatar, data) => useCharacterStore().updateAndSaveCharacter(avatar, data),
  },
  persona: {
    getActive: () => deepClone(usePersonaStore().activePersona),
    getAll: () => deepClone(usePersonaStore().personas),
    setActive: (avatarId) => usePersonaStore().setActivePersona(avatarId),
    updateActiveField: async (field, value) => usePersonaStore().updateActivePersonaField(field, value),
    delete: async (avatarId) => usePersonaStore().deletePersona(avatarId),
  },
  worldInfo: {
    createDefaultEntry(uid) {
      return createDefaultEntry(uid);
    },
    getNewUid(book) {
      return useWorldInfoStore().getNewUid(book);
    },
    getSettings: () => deepClone(useSettingsStore().settings.worldInfo),
    updateSettings: (settings) => {
      const store = useSettingsStore();
      store.settings.worldInfo = { ...store.settings.worldInfo, ...settings };
    },
    getAllBookNames: () => deepClone(useWorldInfoStore().bookInfos),
    getBook: async (name) => {
      const book = await useWorldInfoStore().getBookFromCache(name, true);
      return book ? deepClone(book) : null;
    },
    getActiveBookNames: () => deepClone(useWorldInfoStore().activeBookNames),
    setGlobalBookNames: (names) => {
      useWorldInfoStore().globalBookNames = names;
    },
    createEntry: async (bookName, entry) => {
      const store = useWorldInfoStore();
      store.getBookFromCache(bookName, true).then((book) => {
        if (!book) return;
        const index = book.entries.findIndex((e) => e.uid === entry.uid);
        if (index === -1) {
          book.entries.push({ ...entry });
          store.saveBookDebounced(book);
        }
      });
    },
    updateEntry: async (bookName, entry) => {
      const store = useWorldInfoStore();
      const book = await store.getBookFromCache(bookName, true);
      if (!book) return;
      await store.updateEntry(book, entry);
    },
    deleteEntry: async (bookName, uid) => {
      await useWorldInfoStore().deleteEntry(bookName, uid);
    },
    getSelectedBookName() {
      return useWorldInfoUiStore().selectedFilename;
    },
    getSelectedEntry() {
      const uiStore = useWorldInfoUiStore();
      return uiStore.selectedFilename && uiStore.selectedEntry
        ? {
            bookName: uiStore.selectedFilename,
            entry: uiStore.selectedEntry,
          }
        : null;
    },
  },
  macro: {
    process: (text, context, additionalMacros) => {
      const charStore = useCharacterStore();
      const personaStore = usePersonaStore();

      const characters = context?.characters ?? charStore.activeCharacters;
      const activeCharacter = context?.activeCharacter ?? characters[0];
      const persona = context?.persona ?? personaStore.activePersona;

      if (!persona) throw new Error('No active persona found for macro processing.');

      return macroService.process(text, {
        characters,
        persona,
        activeCharacter,
        additionalMacros,
      });
    },
  },
  tools: {
    register: async (tool) => {
      await useToolStore().registerTool(tool);
    },
    unregister: async (name) => {
      await useToolStore().unregisterTool(name);
    },
    get: (name) => {
      return deepClone(useToolStore().getTool(name));
    },
    getAll: () => {
      return deepClone(useToolStore().toolList);
    },
    getEnabled: () => {
      return deepClone(useToolStore().enabledTools);
    },
    isDisabled: (name) => {
      return useToolStore().isToolDisabled(name);
    },
    toggle: (name, enable) => {
      useToolStore().toggleTool(name, enable);
    },
  },
  ui: {
    isDeviceMobile: () => isDeviceMobile(),
    isMobile: () => {
      const settingsStore = useSettingsStore();
      if (settingsStore.settings.ui.forceMobileMode) {
        return true;
      }
      return isViewportMobile();
    },
    showToast: (message, type = 'info') => toast[type](message),
    openDrawer: (panelName) => {
      useLayoutStore().activeDrawer = panelName;
    },
    closePanel: () => {
      useLayoutStore().activeDrawer = null;
    },
    showPopup: (options) => usePopupStore().show(options),
    registerSidebar: async (id, component, side, options = {}) => {
      const effectiveComponent = component || VanillaSidebar;
      const effectiveProps = component ? options.props : { id, ...options.props };
      useComponentRegistryStore().registerSidebar(
        id,
        {
          component: effectiveComponent,
          componentProps: effectiveProps,
          title: options.title,
          icon: options.icon,
          layoutId: options.layoutId,
        },
        side,
      );
      await Vue.nextTick();
      return id;
    },
    unregisterSidebar(id, side) {
      useComponentRegistryStore().unregisterSidebar(id, side);
    },
    registerNavBarItem: async (id, options) => {
      useComponentRegistryStore().registerNavBarItem(id, {
        icon: options.icon,
        title: options.title,
        component: options.component ?? undefined,
        onClick: options.onClick,
        layout: options.layout,
      });
      await Vue.nextTick();
      return id;
    },
    unregisterNavBarItem: (id) => {
      useComponentRegistryStore().unregisterNavBarItem(id);
    },
    registerChatFormOptionsMenuItem(item) {
      useComponentRegistryStore().registerChatFormOptionsMenuItem(item);
      return () => useComponentRegistryStore().unregisterChatFormOptionsMenuItem(item.id);
    },
    unregisterChatFormOptionsMenuItem(itemId) {
      useComponentRegistryStore().unregisterChatFormOptionsMenuItem(itemId);
    },
    registerChatQuickAction(groupId, groupLabel, action) {
      useComponentRegistryStore().registerChatQuickAction(groupId, groupLabel, action);
      return () => useComponentRegistryStore().unregisterChatQuickAction(groupId, action.id);
    },
    unregisterChatQuickAction(groupId, actionId) {
      useComponentRegistryStore().unregisterChatQuickAction(groupId, actionId);
    },
    openSidebar: (id) => useLayoutStore().toggleRightSidebar(id),
    activateNavBarItem: (id) => useLayoutStore().activateNavBarItem(id),
    autoCloseSidebarsOnMobile: () => useLayoutStore().autoCloseSidebarsOnMobile(),
    selectCharacterForEditing: (avatar) => {
      useCharacterUiStore().selectCharacterByAvatar(avatar);
    },
    registerTextareaTool: (identifier, definition) => {
      useComponentRegistryStore().registerTextareaTool(identifier, definition);
      return () => useComponentRegistryStore().unregisterTextareaTool(identifier, definition.id);
    },
    unregisterTextareaTool(identifier, toolId) {
      useComponentRegistryStore().unregisterTextareaTool(identifier, toolId);
    },
    registerChatSettingsTab: (id, title, component) => {
      const store = useComponentRegistryStore();
      store.registerChatSettingsTab(id, title, component);
      return () => store.unregisterChatSettingsTab(id);
    },
    unregisterChatSettingsTab: (id) => {
      useComponentRegistryStore().unregisterChatSettingsTab(id);
    },
    mountComponent: async (container, componentName, props) => {
      if (!container) return;
      const componentLoader = mountableComponents[componentName];
      if (!componentLoader) return;
      try {
        const mod = await componentLoader();
        container.innerHTML = '';
        const vnode = createVNode(mod.default, props);
        if (mainAppInstance) vnode.appContext = mainAppInstance._context;
        render(vnode, container);
      } catch (err) {
        console.error('Mount failure', err);
      }
    },
    mount: (container, component, props = {}) => {
      if (!container) throw new Error('Target container is null.');
      const vnode = createVNode(component, props);
      if (mainAppInstance) vnode.appContext = mainAppInstance._context;
      render(vnode, container);
      return { unmount: () => render(null, container) };
    },
  },
  events: {
    on: eventEmitter.on.bind(eventEmitter),
    off: eventEmitter.off.bind(eventEmitter),
    emit: eventEmitter.emit.bind(eventEmitter),
  },
  llm: {
    generate: async (messages, options = {}) => {
      const settingsStore = useSettingsStore();
      const characterStore = useCharacterStore();

      // Resolve connection profile settings
      const {
        provider,
        model,
        samplerSettings,
        formatter,
        instructTemplate,
        reasoningTemplate,
        providerSpecific,
        customPromptPostProcessing,
      } = await resolveConnectionProfileSettings({
        profile: options.connectionProfile,
        samplerOverrides: options.samplerOverrides,
      });

      // Apply additional overrides from options
      const effectiveFormatter = options.formatter ?? formatter;
      const effectiveInstructTemplateName = options.instructTemplateName;
      let effectiveInstructTemplate = instructTemplate;
      if (effectiveInstructTemplateName) {
        const apiStore = useApiStore();
        effectiveInstructTemplate = apiStore.instructTemplates.find((t) => t.name === effectiveInstructTemplateName);
      }

      // Apply custom prompt post-processing if defined in profile
      let processedMessages = [...messages];
      if (customPromptPostProcessing && customPromptPostProcessing !== CustomPromptPostProcessing.NONE) {
        processedMessages = await processMessagesWithPrefill(processedMessages, customPromptPostProcessing);

        // Add stop sequences for character and persona names
        if (!samplerSettings?.stop) samplerSettings.stop = [];
        const personaStore = usePersonaStore();
        const activeCharacters = characterStore.activeCharacters;
        const persona = personaStore.activePersona;
        const allNames = [...activeCharacters.map((c) => c.name), persona ? persona.name : 'User', persona?.name || ''];
        samplerSettings.stop.push(...allNames.map((n) => `\n${n}:`));
        samplerSettings.stop = Array.from(new Set(samplerSettings.stop.filter((s) => s && s.trim().length > 0)));
      }

      if (!model) throw new Error('No model specified.');

      const apiStore = useApiStore();
      const payload = buildChatCompletionPayload({
        samplerSettings,
        messages: processedMessages,
        model,
        provider: provider,
        providerSpecific,
        modelList: apiStore.modelList,
        formatter: effectiveFormatter,
        customPromptPostProcessing: customPromptPostProcessing ?? CustomPromptPostProcessing.NONE,
        instructTemplate: effectiveInstructTemplate,
        structuredResponse: options.structuredResponse,
        toolConfig: options.toolConfig,
        activeCharacter: characterStore.activeCharacters[0],
      });

      // Prepare usage tracking
      const tokenizer = new ApiTokenizer({
        tokenizerType: settingsStore.settings.api.tokenizer,
        model: model,
      });

      let inputTokens = 0;
      try {
        if (payload.messages) {
          for (const msg of payload.messages) {
            inputTokens += await countTokens(msg.content, tokenizer);
          }
        } else if (payload.prompt) {
          inputTokens = await countTokens(payload.prompt, tokenizer);
        }
      } catch (err) {
        console.warn('[ExtensionAPI] Failed to count input tokens for tracking:', err);
      }

      return await ChatCompletionService.generate(payload, effectiveFormatter, {
        signal: options.signal,
        tokenizer: tokenizer,
        tracking: {
          source: options.source || 'unknown',
          model: model,
          inputTokens: inputTokens,
        },
        reasoningTemplate: reasoningTemplate,
        structuredResponse: options.structuredResponse,
        toolConfig: options.toolConfig,
        onCompletion: options.onCompletion,
        isContinuation: options.isContinuation,
      });
    },
  },
  i18n: {
    // @ts-expect-error 'i18n.global' is of type 'unknown'
    t: i18n.global.t as StrictT,
  },
};

export function createScopedApiProxy(extensionId: string): ExtensionAPI {
  const settingsStore = useSettingsStore();
  const meta: ExtensionMetadata = { id: extensionId, containerId: getExtensionContainerId(extensionId) };

  const scopedSettings = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (path?: string): any => {
      const fullPath = path ? `extensionSettings.${extensionId}.${path}` : `extensionSettings.${extensionId}`;
      return deepClone(settingsStore.getSetting(fullPath as SettingsPath));
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set: (path: string | undefined, value: any): void => {
      const fullPath = path ? `extensionSettings.${extensionId}.${path}` : `extensionSettings.${extensionId}`;
      settingsStore.setSetting(fullPath as SettingsPath, value);
    },
    getGlobal: baseExtensionAPI.settings.getGlobal,
    setGlobal: baseExtensionAPI.settings.setGlobal,
    save: baseExtensionAPI.settings.save,
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  const listenerMap = new Map<Function, Function>();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  const activeListeners = new Set<{ event: string; listener: Function }>();

  const createIdentifiableAbortController = (controller: AbortController): AbortController => {
    return new Proxy(controller, {
      get(target, prop) {
        if (prop === 'abort') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (reason?: any) => {
            const taggedReason = reason
              ? `[Extension: ${extensionId}] ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`
              : `[Extension: ${extensionId}] Aborted by extension`;
            return target.abort(taggedReason);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };

  const scopedEvents = {
    on: <E extends keyof ExtensionEventMap>(
      eventName: E,
      listener: (...args: ExtensionEventMap[E]) => Promise<void> | void,
      priority?: number,
    ): (() => void) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrappedListener = async (...args: any[]) => {
        const proxiedArgs = args.map((arg) => {
          if (arg instanceof AbortController) return createIdentifiableAbortController(arg);
          if (arg && typeof arg === 'object' && arg.controller instanceof AbortController) {
            return new Proxy(arg, {
              get(target, prop) {
                if (prop === 'controller') return createIdentifiableAbortController(Reflect.get(target, prop));
                return Reflect.get(target, prop);
              },
            });
          }
          return arg;
        });
        return listener(...(proxiedArgs as ExtensionEventMap[E]));
      };

      listenerMap.set(listener, wrappedListener);
      activeListeners.add({ event: eventName, listener: wrappedListener });
      return baseExtensionAPI.events.on(eventName, wrappedListener, priority);
    },
    off: <E extends keyof ExtensionEventMap>(
      eventName: E,
      listener: (...args: ExtensionEventMap[E]) => Promise<void> | void,
    ): void => {
      const wrapped = listenerMap.get(listener);
      if (wrapped) {
        activeListeners.forEach((al) => {
          if (al.event === eventName && al.listener === wrapped) activeListeners.delete(al);
        });
        baseExtensionAPI.events.off(eventName, wrapped as (...args: ExtensionEventMap[E]) => Promise<void> | void);
        listenerMap.delete(listener);
      } else {
        baseExtensionAPI.events.off(eventName, listener);
      }
    },
    emit: baseExtensionAPI.events.emit,
  };

  const scopedLlm = {
    generate: (messages: ApiChatMessage[], options: LlmGenerationOptions = {}) => {
      // Inject source
      const optionsWithSource = { ...options, source: extensionId };
      return baseExtensionAPI.llm.generate(messages, optionsWithSource);
    },
  };

  const scopedUi = {
    ...baseExtensionAPI.ui,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerSidebar: async (id: string, component: Vue.Component | null, side: 'left' | 'right', options: any = {}) => {
      const namespacedId = id.startsWith(extensionId) ? id : `${extensionId}.${id}`;
      const effectiveComponent = component || VanillaSidebar;
      const effectiveProps = component ? options.props : { id: namespacedId, ...options.props };
      useComponentRegistryStore().registerSidebar(
        namespacedId,
        {
          component: effectiveComponent,
          componentProps: effectiveProps,
          title: options.title,
          icon: options.icon,
          layoutId: options.layoutId,
        },
        side,
      );
      await Vue.nextTick();
      return namespacedId;
    },
    unregisterSidebar: (id: string, side: 'left' | 'right') => {
      const namespacedId = id.startsWith(extensionId) ? id : `${extensionId}.${id}`;
      useComponentRegistryStore().unregisterSidebar(namespacedId, side);
    },
    registerNavBarItem: async (
      id: string,
      options: {
        icon: string;
        title: string;
        component?: Vue.Component | null;
        onClick?: () => void;
        layout?: 'default' | 'wide';
      },
    ) => {
      const namespacedId = id.startsWith(extensionId) ? id : `${extensionId}.${id}`;
      useComponentRegistryStore().registerNavBarItem(namespacedId, {
        icon: options.icon,
        title: options.title,
        component: options.component ?? undefined,
        onClick: options.onClick,
        layout: options.layout,
      });
      await Vue.nextTick();
      return namespacedId;
    },
    unregisterNavBarItem: (id: string) => {
      const namespacedId = id.startsWith(extensionId) ? id : `${extensionId}.${id}`;
      useComponentRegistryStore().unregisterNavBarItem(namespacedId);
    },
    openSidebar: (id: string) => {
      const layoutStore = useLayoutStore();
      const componentRegistryStore = useComponentRegistryStore();
      if (componentRegistryStore.rightSidebarRegistry.has(id)) layoutStore.toggleRightSidebar(id);
      else {
        const namespacedId = `${extensionId}.${id}`;
        if (componentRegistryStore.rightSidebarRegistry.has(namespacedId)) layoutStore.toggleRightSidebar(namespacedId);
      }
    },
  };

  extensionCleanupRegistry.set(extensionId, () => {
    activeListeners.forEach(({ event, listener }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      baseExtensionAPI.events.off(event as any, listener as any);
    });
    activeListeners.clear();
    listenerMap.clear();
  });

  return {
    ...baseExtensionAPI,
    meta,
    settings: scopedSettings,
    events: scopedEvents,
    ui: scopedUi,
    llm: scopedLlm,
  };
}

globalThis.NeoTavern = {
  vue: Vue,
  registerExtension: (extensionId: string, initCallback: (extensionId: string, api: ExtensionAPI) => void) => {
    try {
      const api = createScopedApiProxy(extensionId);
      initCallback(extensionId, api);
    } catch (error) {
      console.error(`[Extension] Failed to initialize extension "${extensionId}":`, error);
    }
  },
  api: baseExtensionAPI,
};

Object.freeze(baseExtensionAPI);
Object.keys(baseExtensionAPI).forEach((key) => Object.freeze(baseExtensionAPI[key as keyof typeof baseExtensionAPI]));
export { baseExtensionAPI as extensionAPI };
