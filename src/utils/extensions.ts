import { cloneDeep } from 'lodash-es';
import { createVNode, nextTick, render, type App, type Component } from 'vue';
import { CustomPromptPostProcessing, default_avatar, default_user_avatar } from '../constants';
import type {
  ApiChatMessage,
  Character,
  ChatInfo,
  ChatMessage,
  ExtensionAPI,
  GenerationResponse,
  ItemizedPrompt,
  MediaHydrationContext,
  MessageButtonDefinition,
  MessageDecorationDefinition,
  MountableComponent,
  PromptTokenBreakdown,
  SettingsPath,
  StreamedChunk,
  WorldInfoBook,
} from '../types';
import { api_providers, type ApiProvider } from '../types';
import { isDeviceMobile, isViewportMobile } from './client';
import { getCharactersInMemberOrder } from './character';
import { formatFileSize, getMessageTimeStamp, uuidv4 } from './commons';
import { countTokens } from './token-count';

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
import { usePersonaStore } from '../stores/persona.store';
import { usePopupStore } from '../stores/popup.store';
import { usePromptStore } from '../stores/prompt.store';
import { useSettingsStore } from '../stores/settings.store';
import { useUiStore } from '../stores/ui.store';
import { useWorldInfoStore } from '../stores/world-info.store';

// Service Imports
import { ApiTokenizer } from '../api/tokenizer';
import i18n from '../i18n';
import { macroService } from '../services/macro-service';
import { PromptBuilder } from '../services/prompt-engine';
import { WorldInfoProcessor, createDefaultEntry } from '../services/world-info';
import { useCharacterUiStore } from '../stores/character-ui.store';
import { useComponentRegistryStore } from '../stores/component-registry.store';
import { useLayoutStore } from '../stores/layout.store';
import { useToolStore } from '../stores/tool.store';
import { useWorldInfoUiStore } from '../stores/world-info-ui.store';

import { getModelCapabilities } from '../api/provider-definitions';
import { getThumbnailUrl } from './character';
import { mergeWithUndefinedMulti } from './commons';
import { eventEmitter } from './event-emitter';

// --- API Implementation ---

function deepClone<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj)) as T;
}

const mountableComponents: Record<MountableComponent, () => Promise<{ default: Component }>> = {
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

const extensionDisposers = new Map<string, Map<string, () => void>>();
const extensionServiceRegistry = new Map<string, object>();

/** Runs every cleanup recorded by the extension's API (listeners, registered UI, tools, services). */
export function disposeExtension(extensionId: string) {
  const disposers = extensionDisposers.get(extensionId);
  if (!disposers) return;
  extensionDisposers.delete(extensionId);
  for (const dispose of [...disposers.values()].reverse()) {
    try {
      dispose();
    } catch (error) {
      console.error(`[ExtensionAPI] Cleanup failed for ${extensionId}:`, error);
    }
  }
}

/** Extension ids contain dots, so the id segment is bracket-quoted to keep it a single lodash path key. */
function getScopedSettingsPath(extensionId: string, path?: string): string {
  const scopePath = `extensionSettings["${extensionId}"]`;
  return path ? `${scopePath}.${path}` : scopePath;
}

function namespaceId(extensionId: string, id: string): string {
  return id.startsWith(extensionId) ? id : `${extensionId}.${id}`;
}

export function createExtensionApi(extensionId: string): ExtensionAPI {
  const disposers = new Map<string, () => void>();
  extensionDisposers.set(extensionId, disposers);
  let listenerCount = 0;

  /**
   * Records a cleanup to run on deactivation. Registering the same key again replaces the previous entry,
   * so re-registered UI doesn't accumulate cleanups. The returned function runs the cleanup early.
   */
  const track = (key: string, dispose: () => void): (() => void) => {
    const run = () => {
      if (disposers.get(key) !== run) return;
      disposers.delete(key);
      dispose();
    };
    disposers.set(key, run);
    return run;
  };

  /** Removes a registration now and forgets its tracked cleanup. */
  const release = (key: string, dispose: () => void) => {
    disposers.delete(key);
    dispose();
  };

  return {
    meta: { id: extensionId },
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
      getMessage: (index) => {
        const message = useChatStore().activeChat?.messages[index];
        return message && deepClone(message);
      },
      getChatExtensionData: (key) => {
        const chat = useChatStore().activeChat;
        if (!chat) throw new Error('No active chat.');
        return deepClone(chat.metadata.extra?.[key]);
      },
      save: async () => await useChatStore().saveChat(),
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
      setExtensionData: (location, key, value) => {
        const store = useChatStore();
        if (!store.activeChat) throw new Error('No active chat.');
        let extra: Record<string, unknown>;
        if (location.type === 'chat') {
          store.activeChat.metadata.extra ??= {};
          extra = store.activeChat.metadata.extra;
        } else {
          const messageIndex = location.type === 'message' ? location.index : location.messageIndex;
          const message = store.activeChat.messages[messageIndex];
          if (!message) throw new Error(`Message ${messageIndex} is unavailable.`);
          if (location.type === 'message') extra = message.extra;
          else {
            const swipe = message.swipe_info[location.swipeIndex];
            if (!swipe) throw new Error(`Swipe ${location.swipeIndex} is unavailable.`);
            extra = swipe.extra;
          }
        }
        if (value === undefined) delete extra[key];
        else extra[key] = deepClone(value);
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

        const samplerSettings = {
          ...cloneDeep(settingsStore.settings.api.samplers),
          ...cloneDeep(samplerOverrides),
        };

        return buildChatCompletionPayload({
          samplerSettings,
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
          group: options?.group ?? getCharactersInMemberOrder(characterStore.characters, chatMetadata?.members),
          chatMetadata,
          chatHistory,
          persona,
          samplerSettings: mergeWithUndefinedMulti(
            {},
            cloneDeep(settingsStore.settings.api.samplers),
            cloneDeep(options?.samplerSettings),
          ),
          tokenizer,
          books,
          worldInfo: mergeWithUndefinedMulti({}, settingsStore.settings.worldInfo, options?.worldInfo),
          mediaContext,
          structuredResponse: options?.structuredResponse,
          promptInjections: options?.promptInjections,
          macroEvaluation: 'preview',
          macroRandom: options?.macroRandom,
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
          includedPromptInjectionIds: builder.includedPromptInjectionIds,
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
      get: (path?: string) =>
        deepClone(useSettingsStore().getSetting(getScopedSettingsPath(extensionId, path) as SettingsPath)),
      getGlobal: (path: SettingsPath) => deepClone(useSettingsStore().getSetting(path)),
      set: (path: string | undefined, value: unknown) => {
        useSettingsStore().setSetting(getScopedSettingsPath(extensionId, path) as SettingsPath, value as never);
      },
      setGlobal: (path: SettingsPath, value: never) => useSettingsStore().setSetting(path, value),
      save: () => useSettingsStore().saveSettingsDebounced(),
    } as ExtensionAPI['settings'],
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
        const chatStore = useChatStore();

        const characters = context?.characters ?? charStore.activeCharacters;
        const activeCharacter = context?.activeCharacter ?? characters[0];
        const hasPersonaOverride = context !== undefined && Object.hasOwn(context, 'persona');
        const persona = hasPersonaOverride ? context.persona : (personaStore.activePersona ?? undefined);
        const chatHistory = context?.chatHistory ?? chatStore.activeChat?.messages;
        const chatMetadata = context?.chatMetadata ?? chatStore.activeChat?.metadata;
        const group = context?.group ?? getCharactersInMemberOrder(charStore.characters, chatMetadata?.members);

        if (!persona && !hasPersonaOverride) throw new Error('No active persona found for macro processing.');

        return macroService.process(text, {
          characters,
          persona,
          activeCharacter,
          group,
          chatHistory,
          chatMetadata,
          random: context?.random,
          forbiddenMacros: context?.forbiddenMacros,
          additionalMacros,
        });
      },
    },
    tools: {
      register: async (tool) => {
        await useToolStore().registerTool(tool);
        track(`tool:${tool.name}`, () => void useToolStore().unregisterTool(tool.name));
      },
      unregister: async (name) => {
        disposers.delete(`tool:${name}`);
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
        const namespacedId = namespaceId(extensionId, id);
        useComponentRegistryStore().registerSidebar(
          namespacedId,
          {
            component,
            componentProps: options.props,
            title: options.title,
            icon: options.icon,
            layoutId: options.layoutId,
          },
          side,
        );
        track(`sidebar:${side}:${namespacedId}`, () =>
          useComponentRegistryStore().unregisterSidebar(namespacedId, side),
        );
        await nextTick();
        return namespacedId;
      },
      unregisterSidebar(id, side) {
        const namespacedId = namespaceId(extensionId, id);
        release(`sidebar:${side}:${namespacedId}`, () =>
          useComponentRegistryStore().unregisterSidebar(namespacedId, side),
        );
      },
      registerNavBarItem: async (id, options) => {
        const namespacedId = namespaceId(extensionId, id);
        useComponentRegistryStore().registerNavBarItem(namespacedId, {
          icon: options.icon,
          title: options.title,
          component: options.component ?? undefined,
          onClick: options.onClick,
          layout: options.layout,
          layoutComponent: options.layoutComponent ?? undefined,
          layoutProps: options.layoutProps,
          defaultSidebarId: options.defaultSidebarId,
          targetSidebarId: options.targetSidebarId,
        });
        track(`navbar:${namespacedId}`, () => useComponentRegistryStore().unregisterNavBarItem(namespacedId));
        await nextTick();
        return namespacedId;
      },
      unregisterNavBarItem: (id) => {
        const namespacedId = namespaceId(extensionId, id);
        release(`navbar:${namespacedId}`, () => useComponentRegistryStore().unregisterNavBarItem(namespacedId));
      },
      registerChatFormOptionsMenuItem(item) {
        useComponentRegistryStore().registerChatFormOptionsMenuItem(item);
        return track(`menu:${item.id}`, () => useComponentRegistryStore().unregisterChatFormOptionsMenuItem(item.id));
      },
      unregisterChatFormOptionsMenuItem(itemId) {
        release(`menu:${itemId}`, () => useComponentRegistryStore().unregisterChatFormOptionsMenuItem(itemId));
      },
      registerChatQuickAction(groupId, groupLabel, action) {
        useComponentRegistryStore().registerChatQuickAction(groupId, groupLabel, action);
        return track(`quick-action:${groupId}:${action.id}`, () =>
          useComponentRegistryStore().unregisterChatQuickAction(groupId, action.id),
        );
      },
      unregisterChatQuickAction(groupId, actionId) {
        release(`quick-action:${groupId}:${actionId}`, () =>
          useComponentRegistryStore().unregisterChatQuickAction(groupId, actionId),
        );
      },
      openSidebar: (id) => {
        const rightSidebars = useComponentRegistryStore().rightSidebarRegistry;
        const targetId = rightSidebars.has(id) ? id : namespaceId(extensionId, id);
        if (rightSidebars.has(targetId)) useLayoutStore().toggleRightSidebar(targetId);
      },
      activateNavBarItem: (id) => useLayoutStore().activateNavBarItem(id),
      autoCloseSidebarsOnMobile: () => useLayoutStore().autoCloseSidebarsOnMobile(),
      selectCharacterForEditing: (avatar) => {
        useCharacterUiStore().selectCharacterByAvatar(avatar);
      },
      registerTextareaTool: (identifier, definition) => {
        useComponentRegistryStore().registerTextareaTool(identifier, definition);
        return track(`textarea-tool:${String(identifier)}:${definition.id}`, () =>
          useComponentRegistryStore().unregisterTextareaTool(identifier, definition.id),
        );
      },
      unregisterTextareaTool(identifier, toolId) {
        release(`textarea-tool:${String(identifier)}:${toolId}`, () =>
          useComponentRegistryStore().unregisterTextareaTool(identifier, toolId),
        );
      },
      registerChatSettingsTab: (id, title, component) => {
        const store = useComponentRegistryStore();
        store.registerChatSettingsTab(id, title, component);
        return track(`settings-tab:${id}`, () => store.unregisterChatSettingsTab(id));
      },
      registerSettingsPanel: (component, props = {}) => {
        useComponentRegistryStore().registerExtensionSettingsPanel(extensionId, { component, props });
        return track('settings-panel', () => useComponentRegistryStore().unregisterExtensionSettingsPanel(extensionId));
      },
      registerMessageButton: (definition) => {
        const store = useComponentRegistryStore();
        store.registerMessageButton(definition as MessageButtonDefinition);
        return track(`message-button:${definition.id}`, () => store.unregisterMessageButton(definition.id));
      },
      registerMessageDecoration: (definition) => {
        const store = useComponentRegistryStore();
        store.registerMessageDecoration(definition as MessageDecorationDefinition);
        return track(`message-decoration:${definition.id}`, () => store.unregisterMessageDecoration(definition.id));
      },
      unregisterChatSettingsTab: (id) => {
        release(`settings-tab:${id}`, () => useComponentRegistryStore().unregisterChatSettingsTab(id));
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
      on: (eventName, listener, priority) =>
        track(`listener:${listenerCount++}`, eventEmitter.on(eventName, listener, priority)),
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
          const allNames = [
            ...activeCharacters.map((c) => c.name),
            persona ? persona.name : 'User',
            persona?.name || '',
          ];
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

        const source = extensionId;
        const generationId = options.generationId || uuidv4();
        const requestPayloadController = new AbortController();
        await eventEmitter.emit('process:request-payload', payload, {
          controller: requestPayloadController,
          generationId,
          source,
          model,
          messageIndex: options.captureMessageIndex,
        });
        if (requestPayloadController.signal.aborted) {
          throw new Error('Generation aborted by request payload processor.');
        }

        const response = await ChatCompletionService.generate(payload, effectiveFormatter, {
          signal: options.signal,
          tokenizer: tokenizer,
          tracking: {
            source,
            model: model,
            inputTokens: inputTokens,
          },
          reasoningTemplate: reasoningTemplate,
          structuredResponse: options.structuredResponse,
          toolConfig: options.toolConfig,
          onCompletion: options.onCompletion,
          isContinuation: options.isContinuation,
        });

        if (Symbol.asyncIterator in response) {
          const streamGenerator = response as AsyncGenerator<StreamedChunk>;
          return (async function* () {
            let content = '';
            let reasoning: string | undefined;
            let images: string[] | undefined;
            let toolCalls: StreamedChunk['tool_calls'];

            for await (const chunk of streamGenerator) {
              const chunkController = new AbortController();
              await eventEmitter.emit('process:stream-chunk', chunk, {
                payload,
                controller: chunkController,
                generationId,
                source,
                model,
                messageIndex: options.captureMessageIndex,
              });
              if (chunkController.signal.aborted) break;

              content += chunk.delta ?? '';
              if (chunk.reasoning) reasoning = chunk.reasoning;
              if (chunk.images?.length) images = [...(images ?? []), ...chunk.images];
              if (chunk.tool_calls) toolCalls = chunk.tool_calls;
              yield chunk;
            }

            const responseController = new AbortController();
            await eventEmitter.emit(
              'process:response',
              { content, reasoning, images, tool_calls: toolCalls },
              {
                payload,
                controller: responseController,
                generationId,
                source,
                model,
                messageIndex: options.captureMessageIndex,
              },
            );
          })();
        }

        const generationResponse = response as GenerationResponse;
        const responseController = new AbortController();
        await eventEmitter.emit('process:response', generationResponse, {
          payload,
          controller: responseController,
          generationId,
          source,
          model,
          messageIndex: options.captureMessageIndex,
        });
        if (responseController.signal.aborted) {
          throw new Error('Generation aborted by response processor.');
        }

        return generationResponse;
      },
    },
    extensions: {
      registerService: (id, service) => {
        if (id !== extensionId) throw new Error(`Extension "${extensionId}" cannot register service for "${id}".`);
        extensionServiceRegistry.set(id, service);
        track(`service:${id}`, () => extensionServiceRegistry.delete(id));
      },
      unregisterService: (id) => {
        if (id !== extensionId) throw new Error(`Extension "${extensionId}" cannot unregister service for "${id}".`);
        release(`service:${id}`, () => extensionServiceRegistry.delete(id));
      },
      getService: (id) => {
        return (extensionServiceRegistry.get(id) ?? null) as never;
      },
    },
    i18n: {
      // @ts-expect-error 'i18n.global' is of type 'unknown'
      t: i18n.global.t as StrictT,
    },
    api: {
      getConnectionProfiles: () => {
        return deepClone(useApiStore().connectionProfiles);
      },
      getConnectionProfile: (id: string) => {
        const profile = useApiStore().connectionProfiles.find((p) => p.id === id);
        return profile ? deepClone(profile) : null;
      },
      getModelsForProvider: async (provider: ApiProvider) => {
        const models = await useApiStore().getModelsForProvider(provider);
        return deepClone(models);
      },
      getProviders: () => {
        return deepClone(api_providers);
      },
    },
  };
}
