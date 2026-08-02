import { describe, expect, test, vi } from 'vitest';
import { fetchWorldInfoBook } from '../src/api/world-info';
import { WorldInfoPosition, WorldInfoRole } from '../src/constants';
import { macroService } from '../src/services/macro-service';
import {
  WorldInfoProcessor,
  convertCharacterBookToWorldInfoBook,
  createDefaultEntry,
} from '../src/services/world-info';
import type { Character, ChatMessage, Persona, Tokenizer, WorldInfoBook, WorldInfoSettings } from '../src/types';

vi.mock('../src/utils/client', () => ({
  getRequestHeaders: vi.fn(() => ({})),
}));

// Mock tokenizer
const mockTokenizer: Tokenizer = {
  getTokenCount: async (text: string) => text.length, // Simple length as token count
};

// Mock character
const mockCharacter: Character = {
  name: 'Alice',
  avatar: 'alice.png',
  description: 'A helpful assistant.',
  tags: ['Assistant', 'Helpful'],
  data: {},
};

// Mock persona
const mockPersona: Persona = {
  name: 'User',
  avatarId: 'user',
  description: 'The user.',
  lorebooks: [],
  connections: [],
};

// Mock settings
const mockSettings: WorldInfoSettings = {
  activeBookNames: [],
  depth: 2,
  minActivations: 0,
  minActivationsDepthMax: 0,
  budget: 100, // Percentage
  includeNames: false,
  recursive: true,
  overflowAlert: false,
  caseSensitive: false,
  matchWholeWords: false,
  budgetCap: 10000,
  useGroupScoring: false,
  maxRecursionSteps: 5,
};

// Mock chat
const mockChat: ChatMessage[] = [
  {
    name: 'User',
    mes: 'Hello world',
    send_date: 'now',
    is_user: true,
    is_system: false,
    original_avatar: 'user',
    swipes: [],
    swipe_info: [],
    swipe_id: 0,
    extra: {},
  },
  {
    name: 'Alice',
    mes: 'Hi there!',
    send_date: 'now',
    is_user: false,
    is_system: false,
    original_avatar: 'alice.png',
    swipes: [],
    swipe_info: [],
    swipe_id: 0,
    extra: {},
  },
];

describe('WorldInfoProcessor', () => {
  test('uses the prompt evaluation session and evaluates stateful content once', async () => {
    const entry = createDefaultEntry(1);
    entry.key = ['Hello'];
    entry.content = '{{incvar::worldInfoCount}}';
    const metadata = { integrity: 'world-info-session' };
    const session = macroService.createEvaluationSession({
      characters: [mockCharacter],
      persona: mockPersona,
      chatHistory: mockChat,
      chatMetadata: metadata,
    });
    const processor = new WorldInfoProcessor(
      {
        chat: mockChat,
        characters: [mockCharacter],
        settings: mockSettings,
        books: [{ name: 'Test Book', entries: [entry] }],
        persona: mockPersona,
        maxContext: 1000,
        tokenizer: mockTokenizer,
        generationId: 'test-world-info-session',
        chatMetadata: metadata,
      },
      session,
    );

    const result = await processor.process();

    expect(result.worldInfoBefore).toBe('1');
    expect(session.commit()).toBe(true);
    expect(metadata.extra?.variables).toEqual({ worldInfoCount: 1 });
  });

  test('evaluates a stateful World Info key once when recursion revisits it', async () => {
    const keyEntry = createDefaultEntry(1);
    keyEntry.order = 1;
    keyEntry.key = ['{{incvar::keyCount}}{{getvar::keyCount}}'];
    keyEntry.content = 'Key entry';

    const triggerEntry = createDefaultEntry(2);
    triggerEntry.order = 2;
    triggerEntry.key = ['Hello'];
    triggerEntry.content = '11';

    const metadata = { integrity: 'world-info-key-cache' };
    const session = macroService.createEvaluationSession({
      characters: [mockCharacter],
      persona: mockPersona,
      chatHistory: mockChat,
      chatMetadata: metadata,
    });
    const processor = new WorldInfoProcessor(
      {
        chat: mockChat,
        characters: [mockCharacter],
        settings: mockSettings,
        books: [{ name: 'Test Book', entries: [keyEntry, triggerEntry] }],
        persona: mockPersona,
        maxContext: 1000,
        tokenizer: mockTokenizer,
        generationId: 'test-world-info-key-cache',
        chatMetadata: metadata,
      },
      session,
    );

    const result = await processor.process();

    expect(result.worldInfoBefore).toContain('Key entry');
    expect(session.commit()).toBe(true);
    expect(metadata.extra?.variables).toEqual({ keyCount: 1 });
  });

  test('evaluates identical stateful keys once per configured entry', async () => {
    const firstEntry = createDefaultEntry(1);
    firstEntry.key = ['{{incvar::keyCount}}{{getvar::keyCount}}'];
    firstEntry.content = 'First entry';

    const secondEntry = createDefaultEntry(2);
    secondEntry.key = ['{{incvar::keyCount}}{{getvar::keyCount}}'];
    secondEntry.content = 'Second entry';

    const keyChat = [{ ...mockChat[0], mes: '11 22' }];
    const metadata = { integrity: 'world-info-distinct-key-cache' };
    const session = macroService.createEvaluationSession({
      characters: [mockCharacter],
      persona: mockPersona,
      chatHistory: keyChat,
      chatMetadata: metadata,
    });
    const processor = new WorldInfoProcessor(
      {
        chat: keyChat,
        characters: [mockCharacter],
        settings: mockSettings,
        books: [{ name: 'Test Book', entries: [firstEntry, secondEntry] }],
        persona: mockPersona,
        maxContext: 1000,
        tokenizer: mockTokenizer,
        generationId: 'test-world-info-distinct-key-cache',
        chatMetadata: metadata,
      },
      session,
    );

    const result = await processor.process();

    expect(result.worldInfoBefore).toContain('First entry');
    expect(result.worldInfoBefore).toContain('Second entry');
    expect(session.commit()).toBe(true);
    expect(metadata.extra?.variables).toEqual({ keyCount: 2 });
  });

  test('Activates entry based on key match', async () => {
    const entry = createDefaultEntry(1);
    entry.key = ['Hello'];
    entry.content = 'Activated content';

    const book: WorldInfoBook = { name: 'Test Book', entries: [entry] };

    const processor = new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-gen-id',
    });

    const result = await processor.process();
    expect(result.worldInfoBefore).toContain('Activated content');
  });

  test('Respects case sensitivity setting', async () => {
    const entry = createDefaultEntry(1);
    entry.key = ['hello']; // Lowercase
    entry.content = 'Activated content';
    entry.caseSensitive = true;

    const book: WorldInfoBook = { name: 'Test Book', entries: [entry] };

    // Chat has "Hello", key is "hello", sensitive=true -> should NOT match
    const processor = new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-gen-id',
    });

    let result = await processor.process();
    expect(result.worldInfoBefore).toBe('');

    // Turn off case sensitivity
    entry.caseSensitive = false;
    const processor2 = new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-gen-id-2',
    });

    result = await processor2.process();
    expect(result.worldInfoBefore).toContain('Activated content');
  });

  test('Handles recursion', async () => {
    const entry1 = createDefaultEntry(1);
    entry1.key = ['Hello'];
    entry1.content = 'Trigger for entry 2: Apple';

    const entry2 = createDefaultEntry(2);
    entry2.key = ['Apple'];
    entry2.content = 'Final content';

    const book: WorldInfoBook = { name: 'Test Book', entries: [entry1, entry2] };

    const processor = new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-recursion',
    });

    const result = await processor.process();
    expect(result.worldInfoBefore).toContain('Trigger for entry 2: Apple');
    expect(result.worldInfoBefore).toContain('Final content');
  });

  test('Respects character filters (Name)', async () => {
    const entry = createDefaultEntry(1);
    entry.key = ['Hello'];
    entry.content = 'Only for Bob';
    entry.characterFilterNames = ['Bob']; // Current char is Alice

    const book: WorldInfoBook = { name: 'Test Book', entries: [entry] };

    const processor = new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-filter-fail',
    });

    let result = await processor.process();
    expect(result.worldInfoBefore).toBe('');

    // Update filter to Alice
    entry.characterFilterNames = ['Alice'];
    const processor2 = new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-filter-pass',
    });

    result = await processor2.process();
    expect(result.worldInfoBefore).toContain('Only for Bob'); // Content string, logic works
  });

  test('Respects character filters (Tags)', async () => {
    const entry = createDefaultEntry(1);
    entry.key = ['Hello'];
    entry.content = 'Only for Helpers';
    entry.characterFilterTags = ['helpful'];

    const book: WorldInfoBook = { name: 'Test Book', entries: [entry] };

    const processor = new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-tag-pass',
    });

    const result = await processor.process();
    expect(result.worldInfoBefore).toContain('Only for Helpers');
  });

  test('Respects Group Override (High Priority disables Low Priority)', async () => {
    const entryHigh = createDefaultEntry(1);
    entryHigh.key = ['Hello'];
    entryHigh.content = 'High Priority';
    entryHigh.order = 10;
    entryHigh.group = 'G1';
    entryHigh.groupOverride = true;

    const entryLow = createDefaultEntry(2);
    entryLow.key = ['Hello'];
    entryLow.content = 'Low Priority';
    entryLow.order = 20;
    entryLow.group = 'G1';

    const book: WorldInfoBook = { name: 'Test Book', entries: [entryHigh, entryLow] };

    const processor = new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-group-override',
    });

    const result = await processor.process();
    expect(result.worldInfoBefore).toContain('High Priority');
    expect(result.worldInfoBefore).not.toContain('Low Priority');
  });

  test('Respects Group Weight (High Weight wins over Low Order)', async () => {
    // Entry A: High Order (priority in sorting if weights equal), Low Weight
    const entryA = createDefaultEntry(1);
    entryA.key = ['Hello'];
    entryA.content = 'Entry A';
    entryA.order = 10; // Better order
    entryA.group = 'G1';
    entryA.groupWeight = 10;

    // Entry B: Low Order, High Weight
    const entryB = createDefaultEntry(2);
    entryB.key = ['Hello'];
    entryB.content = 'Entry B';
    entryB.order = 20; // Worse order
    entryB.group = 'G1';
    entryB.groupWeight = 50;

    const book: WorldInfoBook = { name: 'Test Book', entries: [entryA, entryB] };

    const processor = new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-group-weight',
    });

    const result = await processor.process();
    // Entry B should win because 50 > 10, despite order 20 > 10
    expect(result.worldInfoBefore).toContain('Entry B');
    expect(result.worldInfoBefore).not.toContain('Entry A');
  });

  test('Respects Group Scoring (Longer match wins over High Weight)', async () => {
    const chatWithKeywords: ChatMessage[] = [{ ...mockChat[0], mes: 'I love apple pie' }];

    // Entry A: "apple" (Short match), High Weight
    const entryA = createDefaultEntry(1);
    entryA.key = ['apple'];
    entryA.content = 'Entry A';
    entryA.group = 'G1';
    entryA.groupWeight = 100;
    entryA.useGroupScoring = true;

    // Entry B: "apple pie" (Long match), Low Weight
    const entryB = createDefaultEntry(2);
    entryB.key = ['apple pie'];
    entryB.content = 'Entry B';
    entryB.group = 'G1';
    entryB.groupWeight = 10;
    entryB.useGroupScoring = true;

    const book: WorldInfoBook = { name: 'Test Book', entries: [entryA, entryB] };

    const processor = new WorldInfoProcessor({
      chat: chatWithKeywords,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-group-scoring',
    });

    const result = await processor.process();
    // Entry B should win because match length "apple pie" (9) > "apple" (5)
    expect(result.worldInfoBefore).toContain('Entry B');
    expect(result.worldInfoBefore).not.toContain('Entry A');
  });

  test('Respects Delay', async () => {
    const entry = createDefaultEntry(1);
    entry.key = ['Hello'];
    entry.content = 'Delayed';
    entry.delay = 5; // Chat length is 2

    const book: WorldInfoBook = { name: 'Test Book', entries: [entry] };

    const processor = new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-delay',
    });

    let result = await processor.process();
    expect(result.worldInfoBefore).toBe('');

    // Increase chat length
    const longChat = [...mockChat, ...mockChat, ...mockChat]; // 6 messages
    const processor2 = new WorldInfoProcessor({
      chat: longChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-delay-pass',
    });

    result = await processor2.process();
    expect(result.worldInfoBefore).toContain('Delayed');
  });

  test('Correctly places output based on position', async () => {
    const entryBefore = createDefaultEntry(1);
    entryBefore.key = ['Hello'];
    entryBefore.content = 'Before Char';
    entryBefore.position = WorldInfoPosition.BEFORE_CHAR;

    const entryAfter = createDefaultEntry(2);
    entryAfter.key = ['Hello'];
    entryAfter.content = 'After Char';
    entryAfter.position = WorldInfoPosition.AFTER_CHAR;

    const book: WorldInfoBook = { name: 'Test Book', entries: [entryBefore, entryAfter] };

    const processor = new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [book],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'test-position',
    });

    const result = await processor.process();
    expect(result.worldInfoBefore).toContain('Before Char');
    expect(result.worldInfoAfter).toContain('After Char');
  });

  test('preserves each configured role for at-depth entries', async () => {
    const roles = [WorldInfoRole.SYSTEM, WorldInfoRole.USER, WorldInfoRole.ASSISTANT];
    const entries = roles.map((role, index) => {
      const entry = createDefaultEntry(index + 1);
      entry.constant = true;
      entry.content = `Depth role ${role}`;
      entry.position = WorldInfoPosition.AT_DEPTH;
      entry.depth = index;
      entry.role = role;
      return entry;
    });

    const result = await new WorldInfoProcessor({
      chat: mockChat,
      characters: [mockCharacter],
      settings: mockSettings,
      books: [{ name: 'Roles', entries }],
      persona: mockPersona,
      maxContext: 1000,
      tokenizer: mockTokenizer,
      generationId: 'world-info-depth-roles',
    }).process();

    expect(result.depthEntries).toEqual([
      { depth: 0, role: 'system', entries: ['Depth role 0'] },
      { depth: 1, role: 'user', entries: ['Depth role 1'] },
      { depth: 2, role: 'assistant', entries: ['Depth role 2'] },
    ]);
  });

  test('validates imported World Info roles without changing non-depth placement', () => {
    const book = convertCharacterBookToWorldInfoBook({
      name: 'Imported',
      entries: [
        {
          id: 1,
          keys: ['hello'],
          content: 'Imported user entry',
          extensions: { role: 'user' },
        },
      ],
    });

    expect(book.entries[0].role).toBe(WorldInfoRole.USER);
    expect(() =>
      convertCharacterBookToWorldInfoBook({
        name: 'Invalid',
        entries: [{ id: 2, keys: ['hello'], content: 'Invalid', extensions: { role: 'tool' } }],
      }),
    ).toThrow('Unsupported role');
  });

  test('normalizes SillyTavern extension roles before depth processing', async () => {
    const rawBook = {
      name: 'Imported roles',
      entries: [
        {
          ...createDefaultEntry(1),
          role: undefined,
          constant: true,
          content: 'Imported user role',
          position: WorldInfoPosition.AT_DEPTH,
          depth: 0,
          extensions: { role: 'user' },
        },
        {
          ...createDefaultEntry(2),
          role: undefined,
          constant: true,
          content: 'Imported assistant role',
          position: WorldInfoPosition.AT_DEPTH,
          depth: 1,
          extensions: { role: 'assistant' },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(rawBook),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const importedBook = await fetchWorldInfoBook('imported-roles');

      expect(importedBook.entries.map((entry) => entry.role)).toEqual([WorldInfoRole.USER, WorldInfoRole.ASSISTANT]);

      const result = await new WorldInfoProcessor({
        chat: mockChat,
        characters: [mockCharacter],
        settings: mockSettings,
        books: [importedBook],
        persona: mockPersona,
        maxContext: 1000,
        tokenizer: mockTokenizer,
        generationId: 'imported-world-info-roles',
      }).process();

      expect(result.depthEntries).toEqual([
        { depth: 0, role: 'user', entries: ['Imported user role'] },
        { depth: 1, role: 'assistant', entries: ['Imported assistant role'] },
      ]);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          name: 'Unsupported role',
          entries: [{ ...rawBook.entries[0], extensions: { role: 'tool' } }],
        }),
      });

      await expect(fetchWorldInfoBook('unsupported-role')).rejects.toThrow('Unsupported role');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
