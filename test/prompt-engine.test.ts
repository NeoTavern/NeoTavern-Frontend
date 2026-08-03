import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReasoningEffort } from '../src/constants';
import { PromptBuilder } from '../src/services/prompt-engine';
import { WorldInfoProcessor } from '../src/services/world-info';
import type {
  ApiChatContentPart,
  ApiChatMessage,
  Character,
  ChatMessage,
  ChatMetadata,
  KnownPromptIdentifiers,
  Persona,
  SamplerSettings,
  StructuredResponsePrompted,
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
  countTokens: vi.fn(async (content: string | unknown[], tokenizer: Tokenizer) => {
    if (typeof content === 'string') {
      return await tokenizer.getTokenCount(content);
    }
    if (Array.isArray(content)) {
      const textContent = (content as ApiChatContentPart[])
        .filter((part) => part.type === 'text')
        .map((part) => part.text || '')
        .join('');
      return await tokenizer.getTokenCount(textContent);
    }
    return 0;
  }),
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

const mockMediaContext = {
  apiSettings: {
    sendMedia: false,
    imageQuality: 'low' as const,
    forbidExternalMedia: false,
  },
  modelCapabilities: {
    vision: false,
    video: false,
    audio: false,
  },
  formatter: 'chat' as const,
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
  providers: { claude: {}, koboldcpp: {}, google: {}, ollama: {} },
  show_thoughts: false,
  reasoning_effort: ReasoningEffort.MEDIUM,
};

describe('PromptBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (WorldInfoProcessor as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
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
      };
    });
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
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
    });

    const messages = await builder.build();

    // Expect char description
    expect(messages).toContainEqual({ role: 'system', content: 'I am Char1.', name: 'System' });
    // Expect chat history (User: Hello, Char1: Hi) - mapped to api roles
    expect(messages).toContainEqual({ role: 'user', content: 'Hello', name: 'User' });
    expect(messages).toContainEqual({ role: 'assistant', content: 'Hi', name: 'Char1' });

    expect(WorldInfoProcessor).toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith('prompt:building-started', expect.anything());
    expect(eventEmitter.emit).toHaveBeenCalledWith('prompt:built', messages, expect.anything());
  });

  it('normalizes legacy numeric prompt positions at the runtime boundary', async () => {
    const samplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        {
          identifier: 'legacy-relative' as KnownPromptIdentifiers,
          name: 'Legacy relative',
          role: 'system',
          content: 'Legacy relative',
          marker: false,
          enabled: true,
          injection_position: 0,
        },
        { identifier: 'chatHistory', name: 'History', role: 'system', content: '', marker: true, enabled: true },
        {
          identifier: 'legacy-in-chat' as KnownPromptIdentifiers,
          name: 'Legacy in chat',
          role: 'system',
          content: 'Legacy in chat',
          marker: false,
          enabled: true,
          injection_position: 1,
        },
      ],
    } as unknown as SamplerSettings;

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: mockChatHistory,
      samplerSettings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'legacy-injection-position',
      mediaContext: mockMediaContext,
    });

    const messages = await builder.build();

    expect(messages.map((message) => message.content)).toEqual([
      'Legacy relative',
      'Hello',
      'Hi',
      'Legacy in chat',
    ]);
    expect(samplerSettings.prompts[0].injection_position).toBe(0);
    expect(samplerSettings.prompts[2].injection_position).toBe(1);
  });

  it('keeps API roles out of lastCharMessage unless they are assistant messages', async () => {
    const settings: SamplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        {
          identifier: 'custom' as KnownPromptIdentifiers,
          name: 'Chat context',
          role: 'system',
          content: '{{lastMessage}}|{{lastUserMessage}}|{{lastCharMessage}}',
          marker: false,
          enabled: true,
        },
      ],
    };
    const apiHistory: ApiChatMessage[] = [
      { role: 'assistant', content: 'character reply', name: 'Char1' },
      { role: 'system', content: 'system note', name: 'System' },
      { role: 'tool', content: 'tool result', tool_call_id: 'call-1', name: 'Tool' },
    ];

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: apiHistory,
      samplerSettings: settings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'api-role-chat-context',
      mediaContext: mockMediaContext,
    });

    expect((await builder.build())[0].content).toBe('tool result||character reply');
  });

  it('normalizes null assistant content in tool-call-only API history', async () => {
    const settings: SamplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        {
          identifier: 'custom' as KnownPromptIdentifiers,
          name: 'Chat context',
          role: 'system',
          content: '{{lastMessage}}|{{lastUserMessage}}|{{lastCharMessage}}',
          marker: false,
          enabled: true,
        },
      ],
    };
    const apiHistory: ApiChatMessage[] = [
      { role: 'assistant', content: 'previous reply', name: 'Char1' },
      { role: 'user', content: 'question', name: 'User' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'lookup', arguments: '{}' },
          },
        ],
        name: 'Char1',
      },
    ];

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: apiHistory,
      samplerSettings: settings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'api-null-assistant-content',
      mediaContext: mockMediaContext,
    });

    const messages = await builder.build();

    expect(messages[0].content).toBe('|question|');
    expect(messages.some((message) => message.content === 'null')).toBe(false);
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
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
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
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
    });

    const messages = await builder.build();
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.content).toBe('Hello');
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
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
    });

    const messages = await builder.build();
    expect(messages[0].content).toBe('Hello User, I am Char1');
  });

  it('keeps ordered group context separate from the generation character list', async () => {
    const char2 = { ...mockCharacter, name: 'Char2', avatar: 'char2.png' };
    const settings: SamplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        {
          identifier: 'custom' as KnownPromptIdentifiers,
          name: 'Group',
          role: 'system',
          content: '{{group}}|{{char}}',
          marker: false,
          enabled: true,
        },
      ],
    };

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      group: [char2, mockCharacter],
      chatHistory: [],
      samplerSettings: settings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: { ...mockMetadata, members: [char2.avatar, mockCharacter.avatar] },
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'group-order',
      mediaContext: mockMediaContext,
    });

    expect((await builder.build())[0].content).toBe('Char2, Char1|Char1');
  });

  it('uses the ordered group for swap-mode single-speaker generation', async () => {
    const char2 = { ...mockCharacter, name: 'Char2', avatar: 'char2.png' };
    const settings: SamplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        {
          identifier: 'custom' as KnownPromptIdentifiers,
          name: 'Group',
          role: 'system',
          content: '{{char}}/{{group}}',
          marker: false,
          enabled: true,
        },
      ],
    };

    const builder = new PromptBuilder({
      characters: [char2],
      group: [mockCharacter, char2],
      chatHistory: [],
      samplerSettings: settings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: { ...mockMetadata, members: [mockCharacter.avatar, char2.avatar] },
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'group-swap',
      mediaContext: mockMediaContext,
    });

    expect((await builder.build())[0].content).toBe('Char2/Char1, Char2');
  });

  it('falls back to the active character when no group is selected', async () => {
    const settings: SamplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        {
          identifier: 'custom' as KnownPromptIdentifiers,
          name: 'Group',
          role: 'system',
          content: '{{group}}',
          marker: false,
          enabled: true,
        },
      ],
    };

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: [],
      samplerSettings: settings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'group-fallback',
      mediaContext: mockMediaContext,
    });

    expect((await builder.build())[0].content).toBe('Char1');
  });

  it('forwards injected macro randomness and keeps preview prompts read-only', async () => {
    const metadata: ChatMetadata = { integrity: 'extension-contract' };
    const settings: SamplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        {
          identifier: 'custom' as KnownPromptIdentifiers,
          name: 'Extension',
          role: 'system',
          content: '{{roll::1d20}}/{{incvar::count}}',
          marker: false,
          enabled: true,
        },
      ],
    };

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: [],
      samplerSettings: settings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: metadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'extension-contract',
      mediaContext: mockMediaContext,
      macroEvaluation: 'preview',
      macroRandom: () => 0.5,
    });

    expect((await builder.build())[0].content).toBe('11/1');
    expect(metadata.extra).toBeUndefined();
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
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
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
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
    });

    const messages = await builder.build();
    // {{char}} should be replaced by 'Char1'
    expect(messages).toContainEqual({ role: 'system', content: 'I am Char1.', name: 'System' });
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
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
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
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
    });

    const messages = await builder.build();
    const descMsg = messages.find((m) => m.role === 'system' && m.content.includes('I am'));
    // Should contain both descriptions processed correctly
    expect(descMsg?.content).toContain('I am Char1.');
    expect(descMsg?.content).toContain('I am Char2 too.');
  });

  it('inserts World Info entries at specific depth', async () => {
    (WorldInfoProcessor as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
        process: vi.fn().mockResolvedValue({
          worldInfoBefore: '',
          worldInfoAfter: '',
          anBefore: [],
          anAfter: [],
          emBefore: [],
          emAfter: [],
          depthEntries: [
            { depth: 0, role: 'assistant', entries: ['At Depth 0'] },
            { depth: 1, role: 'user', entries: ['At Depth 1'] },
          ],
          outletEntries: {},
          triggeredEntries: {},
        }),
      };
    });

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: mockChatHistory, // [User: Hello, Char1: Hi]
      samplerSettings: mockSamplerSettings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'gen_depth',
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
    });

    const messages = await builder.build();

    // Expected order in history block:
    // [User (Msg1)]
    // [At Depth 1]
    // [Assistant (Msg2)]
    // [At Depth 0]
    // And finally the system prompts (Desc) which come before history in standard config

    // Filter to just the history + injected WI
    // The default prompts have Description first.
    // Index 0: Description
    // Index 1: User (Hello)
    // Index 2: At Depth 1
    // Index 3: Assistant (Hi)
    // Index 4: At Depth 0

    const contentArray = messages.map((m) => m.content);
    expect(contentArray).toEqual([
      'I am Char1.', // Description
      'Hello', // User (Msg 1)
      'At Depth 1', // Injected at depth 1
      'Hi', // Assistant (Msg 2)
      'At Depth 0', // Injected at depth 0
    ]);
    expect(messages.find((message) => message.content === 'At Depth 1')?.role).toBe('user');
    expect(messages.find((message) => message.content === 'At Depth 0')?.role).toBe('assistant');
  });

  it('inserts World Info entries around dialogue examples (EM)', async () => {
    (WorldInfoProcessor as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
        process: vi.fn().mockResolvedValue({
          worldInfoBefore: '',
          worldInfoAfter: '',
          anBefore: [],
          anAfter: [],
          emBefore: ['EM Before'],
          emAfter: ['EM After'],
          depthEntries: [],
          outletEntries: {},
          triggeredEntries: {},
        }),
      };
    });

    const emSettings: SamplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        {
          identifier: 'dialogueExamples',
          name: 'Examples',
          role: 'system',
          content: '',
          marker: true,
          enabled: true,
        },
      ],
    };

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: [],
      samplerSettings: emSettings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'gen_em',
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
    });

    const messages = await builder.build();
    const contentArray = messages.map((m) => m.content);

    // Order: EM Before -> Dialogue Examples -> EM After
    expect(contentArray).toEqual(['EM Before', 'Example 1', 'EM After']);
  });

  it('commits state-changing macros once and leaves preview builds read-only', async () => {
    const metadata: ChatMetadata = { integrity: 'macro-session' };
    const settings: SamplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        {
          identifier: 'custom' as KnownPromptIdentifiers,
          name: 'Stateful',
          role: 'system',
          content: 'count={{incvar::count}}',
          marker: false,
          enabled: true,
        },
      ],
    };

    const previewBuilder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: [],
      samplerSettings: settings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: metadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'macro-preview',
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
      macroEvaluation: 'preview',
    });
    expect((await previewBuilder.build())[0].content).toBe('count=1');
    expect(metadata.extra).toBeUndefined();

    const generationBuilder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: [],
      samplerSettings: settings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: metadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'macro-generation',
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
    });
    expect((await generationBuilder.build())[0].content).toBe('count=1');
    expect((await generationBuilder.build())[0].content).toBe('count=1');
    expect(metadata.extra?.variables).toEqual({ count: 1 });
  });

  it('evaluates structured-response templates in the shared prompt session', async () => {
    const char2 = { ...mockCharacter, name: 'Char2', avatar: 'char2.png' };
    const metadata: ChatMetadata = { integrity: 'structured-session' };
    const structuredResponse: StructuredResponsePrompted = {
      format: 'json',
      schema: {
        name: 'result',
        strict: true,
        value: { type: 'object', properties: { answer: { type: 'string' } } },
      },
      jsonPrompt:
        '{{char}}|{{group}}|{{user}}|{{lastMessage}}|{{chatMetadata.integrity}}|{{roll::1d6}}|{{getvar::origin}}|{{incvar::count}}{{getvar::count}}|{{schema}}|{{example_response}}',
      exampleResponse: { answer: 'example' },
    };
    const settings: SamplerSettings = {
      ...mockSamplerSettings,
      prompts: [
        {
          identifier: 'custom' as KnownPromptIdentifiers,
          name: 'Shared session setup',
          role: 'system',
          content: '{{setvar::origin::prompt}}',
          marker: false,
          enabled: true,
        },
      ],
    };

    const builder = new PromptBuilder({
      characters: [mockCharacter],
      group: [char2, mockCharacter],
      chatHistory: mockChatHistory,
      samplerSettings: settings,
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: metadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'structured-session',
      mediaContext: mockMediaContext,
      structuredResponse,
      macroRandom: () => 0.5,
    });

    const messages = await builder.build();
    const structuredPrompt = messages[messages.length - 1].content;

    expect(structuredPrompt).toContain('Char1|Char2, Char1|User|Hi|structured-session|4|prompt|11');
    expect(structuredPrompt).toContain('"answer": {');
    expect(structuredPrompt).toContain('"answer": "example"');
    expect(metadata.extra?.variables).toEqual({ origin: 'prompt', count: 1 });
    expect(builder.macroVariablesChanged).toBe(true);
  });

  it('keeps relative prompts fixed and orders enabled in-chat prompts by depth, order, role, and configuration', async () => {
    const builder = new PromptBuilder({
      characters: [mockCharacter],
      chatHistory: mockChatHistory,
      samplerSettings: {
        ...mockSamplerSettings,
        prompts: [
          {
            identifier: 'relative-custom' as KnownPromptIdentifiers,
            name: 'Relative',
            role: 'assistant',
            content: 'Relative',
            marker: false,
            enabled: true,
          },
          { identifier: 'chatHistory', name: 'History', role: 'system', content: '', marker: true, enabled: true },
          {
            identifier: 'depth-zero-system' as KnownPromptIdentifiers,
            name: 'Depth zero system',
            role: 'system',
            content: 'Depth 0 system',
            marker: false,
            enabled: true,
            injection_position: 'in-chat',
            injection_depth: 0,
            injection_order: 1,
          },
          {
            identifier: 'depth-zero-assistant' as KnownPromptIdentifiers,
            name: 'Depth zero assistant',
            role: 'assistant',
            content: 'Depth 0 assistant',
            marker: false,
            enabled: true,
            injection_position: 'in-chat',
            injection_depth: 0,
            injection_order: 1,
          },
          {
            identifier: 'depth-zero-user' as KnownPromptIdentifiers,
            name: 'Depth zero user',
            role: 'user',
            content: 'Depth 0 user',
            marker: false,
            enabled: true,
            injection_position: 'in-chat',
            injection_depth: 0,
            injection_order: 1,
          },
          {
            identifier: 'depth-one' as KnownPromptIdentifiers,
            name: 'Depth one',
            role: 'user',
            content: 'Depth 1',
            marker: false,
            enabled: true,
            injection_position: 'in-chat',
            injection_depth: 1,
            injection_order: 0,
          },
          {
            identifier: 'disabled-depth-zero' as KnownPromptIdentifiers,
            name: 'Disabled',
            role: 'system',
            content: 'Disabled',
            marker: false,
            enabled: false,
            injection_position: 'in-chat',
            injection_depth: 0,
            injection_order: 0,
          },
        ],
      },
      persona: mockPersona,
      tokenizer: mockTokenizer,
      chatMetadata: mockMetadata,
      worldInfo: mockWorldInfoSettings,
      books: [],
      generationId: 'generic-depth-prompts',
      mediaContext: mockMediaContext,
      structuredResponse: undefined,
    });

    const messages = await builder.build();

    expect(messages.map((message) => message.content)).toEqual([
      'Relative',
      'Hello',
      'Depth 1',
      'Hi',
      'Depth 0 user',
      'Depth 0 assistant',
      'Depth 0 system',
    ]);
    expect(messages.slice(-3).map((message) => message.role)).toEqual(['user', 'assistant', 'system']);
    expect(messages.some((message) => message.content === 'Disabled')).toBe(false);
  });
});
