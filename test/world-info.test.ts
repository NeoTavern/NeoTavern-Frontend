import { describe, expect, test } from 'vitest';
import { WorldInfoPosition } from '../src/constants';
import { WorldInfoProcessor, createDefaultEntry } from '../src/services/world-info';
import type { Character, ChatMessage, Persona, Tokenizer, WorldInfoBook, WorldInfoSettings } from '../src/types';

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
  title: 'User',
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
});
