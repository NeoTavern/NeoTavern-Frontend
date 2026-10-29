import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatCompletionService } from '../src/api/generation';
import { GenerationMode } from '../src/constants';
import { useChatGeneration, type ChatStateRef } from '../src/composables/useChatGeneration';
import { registerChatLifecycleHooks } from '../src/services/chat-lifecycle';
import { createDefaultSettings } from '../src/services/settings-migration.service';
import { useCharacterStore } from '../src/stores/character.store';
import { usePersonaStore } from '../src/stores/persona.store';
import { useSettingsStore } from '../src/stores/settings.store';
import type { Character, ChatMessage, ChatMetadata, FullChat, Persona } from '../src/types';
import { macroService } from '../src/services/macro-service';
import { eventEmitter } from '../src/utils/event-emitter';
import { ref } from 'vue';

vi.mock('../src/composables/useStrictI18n', () => ({
  useStrictI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../src/api/tokenizer', () => ({
  ApiTokenizer: class {
    async getTokenCount(content: string): Promise<number> {
      return content.length;
    }
  },
}));

const character: Character = {
  name: 'Origin Character',
  avatar: 'origin.png',
  description: '',
  personality: '',
  scenario: '',
  mes_example: '',
  data: {},
};

const persona: Persona = {
  name: 'Origin User',
  avatarId: 'origin-persona',
  description: '',
  lorebooks: [],
  connections: [],
};

describe('chat generation persistence integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());

    const settingsStore = useSettingsStore();
    settingsStore.settings = createDefaultSettings();
    settingsStore.settings.api.selectedProviderModels.openai = 'gpt-4o-mini';
    settingsStore.settings.api.samplers.prompts = [
      {
        identifier: 'custom',
        name: 'Stateful prompt',
        role: 'system',
        content: '{{incvar::count}}',
        marker: false,
        enabled: true,
      },
    ];

    const characterStore = useCharacterStore();
    characterStore.characters = [character];
    characterStore.setActiveCharacterAvatars([character.avatar]);

    const personaStore = usePersonaStore();
    personaStore.personas = [persona];
    personaStore.activePersonaId = persona.avatarId;
  });

  it('awaits hooks around live insertion and assistant finalization events', async () => {
    const order: string[] = [];
    const chat: ChatStateRef = { metadata: { integrity: 'chat' }, messages: [], fileName: 'chat' };
    const unregisterHooks = registerChatLifecycleHooks({
      afterUserMessage: async ({ message }) => {
        expect(chat.messages.includes(message)).toBe(true);
        order.push('after-user');
      },
      beforeGeneration: async () => {
        order.push('before-generation');
        return { assistantContent: 'supplied' };
      },
      afterGeneration: async ({ message }) => {
        expect(chat.messages.includes(message)).toBe(true);
        order.push('after-generation');
      },
    });
    const unregisterCreated = eventEmitter.on('message:created', (message) => {
      order.push(message.is_user ? 'user-created' : 'assistant-created');
    });
    const unregisterFinished = eventEmitter.on('generation:finished', () => {
      order.push('generation-finished');
    });
    const generation = useChatGeneration({
      activeChat: ref(chat),
      syncSwipeToMes: vi.fn(),
      stopAutoModeTimer: vi.fn(),
      findToolChainStart: (index) => index,
      triggerSave: vi.fn(),
      persistChat: vi.fn(),
    });
    try {
      await generation.sendMessage('hello', { triggerGeneration: false });
      await generation.generateResponse(GenerationMode.NEW, { generationId: 'ordered' });
    } finally {
      unregisterFinished();
      unregisterCreated();
      unregisterHooks();
    }
    expect(order).toEqual([
      'after-user',
      'user-created',
      'before-generation',
      'assistant-created',
      'after-generation',
      'generation-finished',
    ]);
  });

  it.each([GenerationMode.NEW, GenerationMode.REGENERATE, GenerationMode.ADD_SWIPE])(
    'applies hook-provided content through the normal %s assistant path',
    async (mode) => {
      const assistant = (content: string): ChatMessage => ({
        name: character.name,
        mes: content,
        is_user: false,
        is_system: false,
        original_avatar: character.avatar,
        send_date: '',
        swipes: [content],
        swipe_id: 0,
        swipe_info: [{ send_date: '', extra: {} }],
        extra: {},
      });
      const messages = mode === GenerationMode.NEW ? [] : [assistant('old')];
      const chat: ChatStateRef = { metadata: { integrity: 'chat' }, messages, fileName: 'chat' };
      const provider = vi.spyOn(ChatCompletionService, 'generate');
      const afterGeneration = vi.fn();
      const unregister = registerChatLifecycleHooks({
        beforeGeneration: async ({ generationMode }) => {
          expect(generationMode).toBe(mode);
          return { assistantContent: 'supplied', includedPromptInjectionIds: ['graph-prompt'] };
        },
        afterGeneration: async (context) => afterGeneration(context),
      });
      const generation = useChatGeneration({
        activeChat: ref(chat),
        syncSwipeToMes: async (index, swipe) => {
          const target = chat.messages[index]!;
          target.swipe_id = swipe;
          target.mes = target.swipes[swipe]!;
        },
        stopAutoModeTimer: vi.fn(),
        findToolChainStart: (index) => index,
        triggerSave: vi.fn(),
        persistChat: vi.fn(),
      });
      try {
        await generation.generateResponse(mode, { generationId: `hook-${mode}` });
      } finally {
        unregister();
      }

      expect(provider).not.toHaveBeenCalled();
      expect(chat.messages.at(-1)?.mes).toBe('supplied');
      if (mode === GenerationMode.ADD_SWIPE) expect(chat.messages[0]?.swipes).toEqual(['old', 'supplied']);
      expect(afterGeneration).toHaveBeenCalledOnce();
      expect(afterGeneration.mock.calls[0]?.[0].includedPromptInjectionIds).toEqual(['graph-prompt']);
    },
  );

  it('forwards only prompt-builder inclusion acknowledgements to after-generation', async () => {
    useSettingsStore().settings.api.samplers.stream = false;
    const chat: ChatStateRef = { metadata: { integrity: 'chat' }, messages: [], fileName: 'chat' };
    vi.spyOn(ChatCompletionService, 'generate').mockResolvedValue({ content: 'default response' });
    const acknowledged = vi.fn();
    const unregister = registerChatLifecycleHooks({
      beforeGeneration: async ({ promptInjections }) => {
        promptInjections.push({
          id: 'included-injection',
          content: 'included prompt',
          role: 'system',
          name: 'Agent',
          placement: 'relative',
          depth: 0,
        });
      },
      afterGeneration: async ({ includedPromptInjectionIds }) => acknowledged(includedPromptInjectionIds),
    });
    const generation = useChatGeneration({
      activeChat: ref(chat),
      syncSwipeToMes: vi.fn(),
      stopAutoModeTimer: vi.fn(),
      findToolChainStart: (index) => index,
      triggerSave: vi.fn(),
      persistChat: vi.fn(),
    });
    try {
      await generation.generateResponse(GenerationMode.NEW, { generationId: 'normal-generation' });
    } finally {
      unregister();
    }
    expect(acknowledged).toHaveBeenCalledWith(['included-injection']);
  });

  it('saves origin-bound variables and reloads them without leaking into a replacement chat', async () => {
    const originMetadata: ChatMetadata = { integrity: 'origin' };
    const originChat: ChatStateRef = { metadata: originMetadata, messages: [], fileName: 'origin-chat' };
    const replacementChat: ChatStateRef = {
      metadata: { integrity: 'replacement' },
      messages: [],
      fileName: 'replacement-chat',
    };
    const activeChat = ref<ChatStateRef | null>(originChat);
    const persisted: { chat: ChatStateRef; file: string; data: FullChat }[] = [];

    const persistChat = vi.fn(async (chat: ChatStateRef, file: string) => {
      persisted.push({
        chat,
        file,
        data: JSON.parse(JSON.stringify([{ chat_metadata: chat.metadata }, ...chat.messages])) as FullChat,
      });
      activeChat.value = replacementChat;
    });

    vi.spyOn(ChatCompletionService, 'generate').mockResolvedValue({ content: 'unused' });

    const generation = useChatGeneration({
      activeChat,
      syncSwipeToMes: vi.fn(async () => undefined),
      stopAutoModeTimer: vi.fn(),
      findToolChainStart: vi.fn(() => 0),
      triggerSave: vi.fn(),
      persistChat,
    });

    await generation.generateResponse(GenerationMode.NEW, { generationId: 'origin-generation' });

    expect(persistChat).toHaveBeenCalledTimes(1);
    expect(persisted[0]).toMatchObject({ chat: originChat, file: 'origin-chat' });
    expect(persisted[0].data[0]).toEqual({
      chat_metadata: { integrity: 'origin', extra: { variables: { count: 1 } } },
    });
    expect(replacementChat.metadata.extra).toBeUndefined();
    expect(persisted.some((entry) => entry.file === 'replacement-chat')).toBe(false);

    const reloadedMetadata = JSON.parse(JSON.stringify(persisted[0].data[0].chat_metadata)) as ChatMetadata;
    const reloadedSession = macroService.createEvaluationSession({
      characters: [character],
      persona,
      chatMetadata: reloadedMetadata,
    });
    expect(reloadedSession.evaluate('{{getvar::count}}')).toBe('1');
  });
});
