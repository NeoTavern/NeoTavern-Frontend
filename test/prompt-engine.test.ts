import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReasoningEffort } from '../src/constants';
import { PromptBuilder } from '../src/services/prompt-engine';
import { WorldInfoProcessor } from '../src/services/world-info';
import type {
  Character,
  ChatMessage,
  ChatMetadata,
  KnownPromptIdentifiers,
  Persona,
  SamplerSettings,
  Tokenizer,
  WorldInfoSettings,
} from '../src/types';
import { eventEmitter } from '../src/utils/extensions';

// Mock dependencies
vi.mock('../src/services/world-info');
vi.mock('../src/utils/extensions', () => ({
  eventEmitter: {
    emit: vi.fn(),
  },
}));

// Mock Tokenizer
const mockTokenizer: Tokenizer = {
  getTokenCount: vi.fn(async (text: string) => text.length),
};

const mockCharacter: Character = {
  name: 'Char1',
  avatar: 'char1.png',
  description: 'I am {{char}}.',
  personality: 'Personality 1',
  scenario: 'Scenario 1',
  mes_example: 'Example 1',
  data: {
    post_history_instructions: 'Jailbreak 1',
  },
};

const mockPersona: Persona = {
  name: 'User',
  avatarId: 'user1',
  description: 'User Description',
  lorebooks: [],
  connections: [],
};

const mockChatHistory: ChatMessage[] = [
  {
    name: 'User',
    mes: 'Hello',
    send_date: '1',
    is_user: true,
    is_system: false,
    original_avatar: 'user',
    swipes: [],
    swipe_info: [],
    swipe_id: 0,
    extra: {},
  },
  {
    name: 'Char1',
    mes: 'Hi',
    send_date: '2',
    is_user: false,
    is_system: false,
    original_avatar: 'char1.png',
    swipes: [],
    swipe_info: [],
    swipe_id: 0,
    extra: {},
  },
];

const mockMetadata: ChatMetadata = {
  integrity: 'hash',
};

const mockWorldInfoSettings: WorldInfoSettings = {
  activeBookNames: [],
  depth: 2,
  minActivations: 0,
  minActivationsDepthMax: 0,
  budget: 100,
  includeNames: false,
  recursive: false,
  overflowAlert: false,
  caseSensitive: false,
  matchWholeWords: false,
  budgetCap: 0,
  useGroupScoring: false,
  maxRecursionSteps: 0,
};

const mockSamplerSettings: SamplerSettings = {
  temperature: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
  top_p: 1,
  top_k: 0,
  top_a: 0,
  min_p: 0,
  max_context: 200,
  max_tokens: 50,
  stream: false,
  seed: -1,
  stop: [],
  n: 1,
  prompts: [
    { identifier: 'charDescription', name: 'Desc', role: 'system', content: '', marker: true, enabled: true },
    { identifier: 'chatHistory', name: 'History', role: 'system', content: '', marker: true, enabled: true },
  ],
  providers: { claude: {}, koboldcpp: {}, google: {} },
  show_thoughts: false,
  reasoning_effort: ReasoningEffort.MEDIUM,
};

describe('PromptBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (WorldInfoProcessor as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      process: vi.fn().mockResolvedValue({
        worldInfoBefore: '',
        worldInfoAfter: '',
        anBefore: [],
        anAfter: [],
        emBefore: [],
        emAfter: [],
        depthEntries: [],
        outletEntries: {},
        triggeredEntries: {},
      }),
    }));
  });

  it('builds prompts with single character context', async () => {
    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: mockChatHistory,
      samplerSettings: mockSamplerSettings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'gen1',
    });

    const messages = await builder.build();

    // Expect char description
    expect(messages).toContainEqual({ role: 'system', content: 'I am Char1.' });
    // Expect chat history (User: Hello, Char1: Hi) - mapped to api roles
    expect(messages).toContainEqual({ role: 'user', content: 'Hello', name: 'User' });
    expect(messages).toContainEqual({ role: 'assistant', content: 'Hi', name: 'Char1' });

    expect(WorldInfoProcessor).toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith('prompt:building-started', expect.anything());
    expect(eventEmitter.emit).toHaveBeenCalledWith('prompt:built', messages, expect.anything());
  });

  it('respects max context and history budgeting', async () => {
    // Create long history
    const longHistory: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      longHistory.push({
        name: i % 2 === 0 ? 'User' : 'Char1',
        mes: 'A'.repeat(10), // 10 tokens per message roughly
        is_user: i % 2 === 0,
        is_system: false,
        send_date: String(i),
        original_avatar: 'avatar',
        swipes: [],
        swipe_info: [],
        swipe_id: 0,
        extra: {},
      });
    }

    // System prompts take some space. Description 1 = 13 chars.
    // WI = WI_BEFORE (9) + WI_AFTER (8) = 17 chars (not in prompts list above though).

    // Update prompts to include WI to take up space
    const settings: SamplerSettings = {
      ...mockSamplerSettings,
      max_context: 100, // Very tight budget
      prompts: [
        { identifier: 'worldInfoBefore', name: 'WI', role: 'system', content: '', marker: true, enabled: true },
        { identifier: 'chatHistory', name: 'Hist', role: 'system', content: '', marker: true, enabled: true },
      ],
    };

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: longHistory,
      samplerSettings: settings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'gen2',
    });

    const messages = await builder.build();

    // Should contain WI_BEFORE
    expect(messages[0]).toEqual({ role: 'assistant', name: 'Char1', content: 'AAAAAAAAAA' });

    // Budget calculation:
    // Max Context = 100
    // Max Response = 50
    // Fixed Prompts = 9 (WI_BEFORE)
    // History Budget = 100 - 9 - 50 = 41 tokens.
    // Each message is 10 tokens.
    // Should fit ~4 messages.

    // Verify history messages are at the end and limited
    const historyMsgs = messages.slice(1);
    expect(historyMsgs.length).toBeLessThan(longHistory.length);
    expect(historyMsgs.length).toBeGreaterThan(0);
    // Should contain the last messages
    expect(historyMsgs[historyMsgs.length - 1].content).toBe('AAAAAAAAAA');
  });

  it('handles group chat formatting for assistant messages', async () => {
    const char2 = { ...mockCharacter, name: 'Char2' };
    const groupHistory = [
      {
        name: 'Char1',
        mes: 'Hello',
        is_user: false,
        is_system: false,
        send_date: '1',
        original_avatar: '1',
        swipes: [],
        swipe_info: [],
        swipe_id: 0,
        extra: {},
      },
    ];

    const builder = new PromptBuilder({
      characters: [mockCharacter, char2],
      chatHistory: groupHistory,
      samplerSettings: mockSamplerSettings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: { ...mockMetadata, members: ['1', '2'] }, // trigger group context
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'gen3',
    });

    const messages = await builder.build();
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.content).toBe('Char1: Hello');
  });

  it('substitutes macros in custom prompts', async () => {
    const customPromptSettings: SamplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        {
          identifier: 'custom' as KnownPromptIdentifiers,
          name: 'Custom',
          role: 'system',
          content: 'Hello {{user}}, I am {{char}}',
          marker: false,
          enabled: true,
        },
        { identifier: 'chatHistory', name: 'Hist', role: 'system', content: '', marker: true, enabled: true },
      ],
    };

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: [],
      samplerSettings: customPromptSettings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'gen4',
    });

    const messages = await builder.build();
    expect(messages[0].content).toBe('Hello User, I am Char1');
  });

  it('skips disabled prompts', async () => {
    const disabledSettings: SamplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        { identifier: 'charDescription', name: 'Desc', role: 'system', content: 'desc', marker: true, enabled: false },
        { identifier: 'chatHistory', name: 'Hist', role: 'system', content: '', marker: true, enabled: true },
      ],
    };

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: mockChatHistory,
      samplerSettings: disabledSettings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'gen5',
    });

    const messages = await builder.build();
    // Description should not be present
    expect(messages.find((m) => m.content === 'Description 1')).toBeUndefined();
    // History should be present
    expect(messages.length).toBe(2);
  });

  it('processes macros in character description', async () => {
    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: [],
      samplerSettings: mockSamplerSettings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'gen1',
    });

    const messages = await builder.build();
    // {{char}} should be replaced by 'Char1'
    expect(messages).toContainEqual({ role: 'system', content: 'I am Char1.' });
  });

  it('processes macros in chat history', async () => {
    const history: ChatMessage[] = [
      {
        name: 'Char1',
        mes: 'Hello {{user}}',
        send_date: '1',
        is_user: false,
        is_system: false,
        original_avatar: 'char1.png',
        swipes: [],
        swipe_info: [],
        swipe_id: 0,
        extra: {},
      },
    ];

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: history,
      samplerSettings: mockSamplerSettings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'gen2',
    });

    const messages = await builder.build();
    // {{user}} should be replaced by 'User'
    expect(messages).toContainEqual({ role: 'assistant', content: 'Hello User', name: 'Char1' });
  });

  it('processes group chat character descriptions correctly', async () => {
    const char2 = { ...mockCharacter, name: 'Char2', description: 'I am {{char}} too.' };
    const builder = new PromptBuilder({
      characters: [mockCharacter, char2],
      chatHistory: [],
      samplerSettings: mockSamplerSettings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: { ...mockMetadata, members: ['1', '2'] },
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'gen3',
    });

    const messages = await builder.build();
    const descMsg = messages.find((m) => m.role === 'system' && m.content.includes('I am'));
    // Should contain both descriptions processed correctly
    expect(descMsg?.content).toContain('I am Char1.');
    expect(descMsg?.content).toContain('I am Char2 too.');
  });
});
