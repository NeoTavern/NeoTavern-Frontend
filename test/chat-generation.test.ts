import { setActivePinia, createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatCompletionService } from '../src/api/generation';
import { GenerationMode } from '../src/constants';
import { useChatGeneration, type ChatStateRef } from '../src/composables/useChatGeneration';
import { createDefaultSettings } from '../src/services/settings-migration.service';
import { useCharacterStore } from '../src/stores/character.store';
import { usePersonaStore } from '../src/stores/persona.store';
import { useSettingsStore } from '../src/stores/settings.store';
import type { Character, ChatMetadata, FullChat, Persona } from '../src/types';
import { macroService } from '../src/services/macro-service';
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
