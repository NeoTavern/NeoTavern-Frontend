import * as Vue from 'vue';
import { createVNode, render, type App } from 'vue';
import { EventPriority, GenerationMode, default_avatar } from '../constants';
import type {
  ChatMessage,
  ExtensionAPI,
  ExtensionEventMap,
  ExtensionMetadata,
  MountableComponent,
  SettingsPath,
} from '../types';
import { sanitizeSelector } from './client';
import { getMessageTimeStamp } from './commons';

// Internal Store Imports
import { ChatCompletionService, buildChatCompletionPayload } from '../api/generation';
import { toast } from '../composables/useToast';
import { useApiStore } from '../stores/api.store';
import { useCharacterStore } from '../stores/character.store';
import { useChatStore } from '../stores/chat.store';
import { getExtensionContainerId } from '../stores/extension.store';
import { usePersonaStore } from '../stores/persona.store';
import { usePopupStore } from '../stores/popup.store';
import { useSettingsStore } from '../stores/settings.store';
import { useUiStore } from '../stores/ui.store';
import { useWorldInfoStore } from '../stores/world-info.store';

// Service Imports
import VanillaSidebar from '../components/Shared/VanillaSidebar.vue';
import { PromptBuilder } from '../services/prompt-engine';
import { WorldInfoProcessor } from '../services/world-info';
import { useComponentRegistryStore } from '../stores/component-registry.store';
import { useLayoutStore } from '../stores/layout.store';

// --- Event Emitter ---

type EventName = keyof ExtensionEventMap;
type Listener<E extends EventName> = (...args: ExtensionEventMap[E]) => Promise<void> | void;

interface ListenerObject<E extends EventName> {
  listener: Listener<E>;
  priority: number;
}

class EventEmitter {
  private events: { [E in EventName]?: ListenerObject<E>[] } = {};

  on<E extends EventName>(
    eventName: E,
    listener: Listener<E>,
    priority: number | EventPriority = EventPriority.MEDIUM,
  ): () => void {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }
    const listenerObject = { listener, priority };
    this.events[eventName]!.push(listenerObject);
    this.events[eventName]!.sort((a, b) => b.priority - a.priority);
    return () => this.off(eventName, listener);
  }

  off<E extends EventName>(eventName: E, listener: Listener<E>): void {
    if (!this.events[eventName]) return;
    const index = this.events[eventName]!.findIndex((l) => l.listener === listener);
    if (index > -1) {
      this.events[eventName]!.splice(index, 1);
    }
  }

  async emit<E extends EventName>(eventName: E, ...args: ExtensionEventMap[E]): Promise<void> {
    const listeners = this.events[eventName];
    if (!listeners) return;
    for (const listenerObject of [...listeners]) {
      try {
        await listenerObject.listener(...args);
      } catch (error) {
        console.error(`Error in event listener for event "${eventName}":`, error);
      }
    }
  }
}

export const eventEmitter = new EventEmitter();

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
  Input: () => import('../components/UI/Input.vue'),
  ListItem: () => import('../components/UI/ListItem.vue'),
  Search: () => import('../components/UI/Search.vue'),
  Select: () => import('../components/UI/Select.vue'),
  Tabs: () => import('../components/UI/Tabs.vue'),
  Textarea: () => import('../components/UI/Textarea.vue'),
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
    getLastMessage: () => {
      const messages = useChatStore().activeChat?.messages ?? [];
      return messages.length > 0 ? deepClone(messages[messages.length - 1]) : null;
    },
    insertMessage: (message, index) => {
      const store = useChatStore();
      if (!store.activeChat) throw new Error('No active chat.');
      const fullMessage: ChatMessage = { ...message, send_date: message.send_date ?? getMessageTimeStamp() };
      const messages = store.activeChat.messages;
      if (index === undefined || index < 0 || index >= messages.length) {
        messages.push(fullMessage);
      } else {
        messages.splice(index, 0, fullMessage);
      }
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
    regenerateResponse: async (options) => {
      return await useChatStore().generateResponse(GenerationMode.REGENERATE, options);
    },
    continueResponse: async (options) => {
      return await useChatStore().generateResponse(GenerationMode.CONTINUE, options);
    },
    clear: async () => {
      return await useChatStore().clearChat(true);
    },
    abortGeneration: () => {
      useChatStore().abortGeneration();
    },
    generate: async (payload, signal) => {
      return await ChatCompletionService.generate(payload, signal);
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
        playerName: uiStore.activePlayerName || 'User',
        modelList: apiStore.modelList,
      });
    },
    metadata: {
      get: () => deepClone(useChatStore().activeChat?.metadata ?? null),
      set: (metadata) => {
        const store = useChatStore();
        if (store.activeChat) store.activeChat.metadata = metadata;
      },
      update: (updates) => {
        const store = useChatStore();
        if (store.activeChat) store.activeChat.metadata = { ...store.activeChat.metadata, ...updates };
      },
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
    updateEntry: async (bookName, entry) => {
      const store = useWorldInfoStore();
      const book = await store.getBookFromCache(bookName, true);
      if (!book) return;
      const index = book.entries.findIndex((e) => e.uid === entry.uid);
      if (index > -1) {
        book.entries[index] = { ...entry };
        store.saveBookDebounced(book);
      }
    },
  },
  ui: {
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
    openSidebar: (id) => useLayoutStore().toggleRightSidebar(id),
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
      const apiStore = useApiStore();
      let provider = settingsStore.settings.api.provider;
      let model = apiStore.activeModel;
      let samplerSettings = { ...settingsStore.settings.api.samplers, ...(options.samplerOverrides ?? {}) };

      if (options.connectionProfileName) {
        const profile = apiStore.connectionProfiles.find((p) => p.name === options.connectionProfileName);
        if (!profile) throw new Error(`Profile "${options.connectionProfileName}" not found.`);
        provider = profile.provider ?? provider;
        model = profile.model ?? model;
        if (profile.sampler) {
          const sampler = apiStore.presets.find((p) => p.name === profile.sampler);
          if (sampler) samplerSettings = { ...sampler.preset, ...(options.samplerOverrides ?? {}) };
        }
        if (profile.customPromptPostProcessing) {
          messages = await ChatCompletionService.formatMessages(messages, profile.customPromptPostProcessing);
        }
      }
      if (!model) throw new Error('No model specified.');

      const payload = buildChatCompletionPayload({
        samplerSettings,
        messages,
        model,
        provider: provider,
        providerSpecific: settingsStore.settings.api.providerSpecific,
        modelList: apiStore.modelList,
      });
      return await ChatCompletionService.generate(payload, options.signal);
    },
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

  return { ...baseExtensionAPI, meta, settings: scopedSettings, events: scopedEvents, ui: scopedUi };
}

globalThis.SillyTavern = {
  vue: Vue,
  registerExtension: (extensionId: string, initCallback: (extensionId: string, api: ExtensionAPI) => void) => {
    try {
      const api = createScopedApiProxy(extensionId);
      initCallback(extensionId, api);
    } catch (error) {
      console.error(`[Extension] Failed to initialize extension "${extensionId}":`, error);
    }
  },
};

Object.freeze(baseExtensionAPI);
Object.keys(baseExtensionAPI).forEach((key) => Object.freeze(baseExtensionAPI[key as keyof typeof baseExtensionAPI]));
export { baseExtensionAPI as extensionAPI };
