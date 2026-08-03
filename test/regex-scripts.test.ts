import { beforeEach, describe, expect, it, vi } from 'vitest';
import ff5Fixture from './fixtures/ff5-regex-preset.json';
import { ReasoningEffort } from '../src/constants';
import { PromptBuilder } from '../src/services/prompt-engine';
import {
  applyMarkdownRegexScripts,
  applyPromptRegexScripts,
  normalizeRegexScript,
  runRegexScript,
} from '../src/services/regex-scripts';
import { migrateLegacyOaiPreset } from '../src/services/settings-migration.service';
import type { Character, ChatMessage, Persona, SamplerSettings, Tokenizer, WorldInfoSettings } from '../src/types';

vi.mock('../src/services/world-info', () => ({
  WorldInfoProcessor: vi.fn(),
}));

vi.mock('../src/utils/extensions', () => ({
  eventEmitter: { emit: vi.fn() },
  countTokens: vi.fn(async (content: string | unknown[], tokenizer: Tokenizer) => {
    if (typeof content === 'string') return tokenizer.getTokenCount(content);
    return 0;
  }),
}));

const { WorldInfoProcessor } = await import('../src/services/world-info');

const character = {
  name: 'Char',
  description: '',
  personality: '',
  scenario: '',
  mes_example: '',
  data: {},
} as Character;
const persona = { name: 'User', avatarId: 'user', description: '', lorebooks: [], connections: [] } as Persona;
const worldInfo = {
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
} as WorldInfoSettings;
const tokenizer: Tokenizer = { getTokenCount: async (value: string) => value.length };
const mediaContext = {
  apiSettings: { sendMedia: false, imageQuality: 'low' as const, forbidExternalMedia: false },
  modelCapabilities: { vision: false, video: false, audio: false },
  formatter: 'chat' as const,
};

function message(name: string, content: string, isUser = false): ChatMessage {
  return {
    name,
    mes: content,
    send_date: name,
    is_user: isUser,
    is_system: false,
    original_avatar: name,
    swipes: [],
    swipe_info: [],
    swipe_id: 0,
    extra: {},
  };
}

function settings(
  regex_scripts: SamplerSettings['regex_scripts'],
  prompts = [
    { identifier: 'chatHistory', name: 'History', role: 'system' as const, content: '', marker: true, enabled: true },
  ],
): SamplerSettings {
  return {
    temperature: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    repetition_penalty: 1,
    top_p: 1,
    top_k: 0,
    top_a: 0,
    min_p: 0,
    max_context: 100,
    max_tokens: 0,
    stream: false,
    seed: -1,
    stop: [],
    n: 1,
    prompts,
    regex_scripts,
    providers: { claude: {}, koboldcpp: {}, google: {}, ollama: {} },
    show_thoughts: false,
    reasoning_effort: ReasoningEffort.MEDIUM,
  };
}

function build(
  regex_scripts: SamplerSettings['regex_scripts'],
  chatHistory: ChatMessage[],
  sampler = settings(regex_scripts),
) {
  return new PromptBuilder({
    characters: [character],
    chatHistory,
    samplerSettings: sampler,
    persona,
    tokenizer,
    chatMetadata: { integrity: 'regex-test' },
    worldInfo,
    books: [],
    generationId: 'regex-test',
    mediaContext,
  });
}

describe('FF5 regex preset migration', () => {
  it('preserves prompt order/configuration and all three prompt scripts plus display-only scripts', () => {
    const migrated = migrateLegacyOaiPreset(ff5Fixture);

    expect(migrated.prompts.map((prompt) => prompt.identifier)).toEqual([
      'relative-main',
      'in-chat-user',
      'in-chat-assistant',
      'disabled-depth',
    ]);
    expect(migrated.prompts).toMatchObject([
      {
        identifier: 'relative-main',
        enabled: true,
        role: 'system',
        injection_position: 'relative',
        injection_depth: 4,
        injection_order: 8,
      },
      {
        identifier: 'in-chat-user',
        enabled: true,
        role: 'user',
        injection_position: 'in-chat',
        injection_depth: 1,
        injection_order: 2,
      },
      {
        identifier: 'in-chat-assistant',
        enabled: true,
        role: 'assistant',
        injection_position: 'in-chat',
        injection_depth: 3,
        injection_order: 1,
      },
      { identifier: 'disabled-depth', enabled: false, role: 'system', injection_depth: 0 },
    ]);

    expect(migrated.regex_scripts?.map((script) => script.scriptName)).toEqual(ff5Fixture.expected.regexOrder);
    const migratedScript = (scriptName: string) =>
      migrated.regex_scripts?.find((script) => script.scriptName === scriptName);
    expect(migratedScript('FF5 - Image Prompt Stripper')).toMatchObject({
      pattern: '<!--\\s*IMG_PROMPT:[^>]*-->',
      flags: 'g',
      replacement: '',
      enabled: true,
      promptOnly: true,
      markdownOnly: false,
      placement: ['assistant'],
      minDepth: 0,
    });
    expect(migratedScript('FF5 - GFX Stripper')).toMatchObject({
      pattern: '<!-- GFX_START -->\\s*<div[^>]*?>([\\s\\S]*?)<\\/div>\\s*<!-- GFX_END -->',
      flags: 'g',
      replacement: '$1',
      promptOnly: true,
      markdownOnly: false,
      placement: ['assistant'],
      minDepth: 0,
    });
    expect(migratedScript('FF5 - Context Saver')).toMatchObject({
      pattern: '<!-- GFX_START -->\\s+<internal_states>[\\s\\S]*?<!-- GFX_END -->',
      flags: 'g',
      replacement: '',
      promptOnly: true,
      markdownOnly: false,
      placement: ['assistant'],
      minDepth: 2,
      maxDepth: undefined,
    });
    expect(migratedScript('FF5 - Relationship Bars (Positive)')).toMatchObject({
      pattern:
        '-?\\s*(?:<b[^>]*>)?\\s*([^<|↔\\n]+?)\\s*(?:<\\/b>)?\\s*↔\\s*(?:<b[^>]*>)?\\s*([^<|\\n]+?)\\s*(?:<\\/b>)?\\s*\\|\\s*(?:BOND|Bond):\\s*(\\+?)(\\d+)\\s*\\|\\s*(?:SPARKS?|Sparks?):\\s*(\\d+)\\s*\\|\\s*(?:GRUDGE|Grudge):\\s*(\\d+)',
      promptOnly: true,
      markdownOnly: true,
      placement: ['assistant'],
    });
    expect(migratedScript('FF5 UI - Menu Master')).toMatchObject({
      pattern: '<details>\\s*<summary>([^<]*?)(INTERNAL STATES)([^<]*?)<\\/summary>',
      promptOnly: false,
      markdownOnly: true,
      placement: ['assistant'],
    });
    expect(migratedScript('FF5 UI - Highlights')).toMatchObject({
      pattern: '-\\s*<b[^>]*?>(.*?)<\\/b>(?!\\s*↔)',
      promptOnly: false,
      markdownOnly: true,
      placement: ['assistant'],
    });

    expect(
      runRegexScript(migratedScript('FF5 - Image Prompt Stripper')!, 'Narrative\n<!-- IMG_PROMPT: remove -->'),
    ).toBe(ff5Fixture.expected.imagePrompt);
    expect(
      runRegexScript(migratedScript('FF5 - GFX Stripper')!, '<!-- GFX_START --><div>state</div><!-- GFX_END -->'),
    ).toBe('state');
    expect(
      runRegexScript(
        migratedScript('FF5 - Context Saver')!,
        'before <!-- GFX_START -->\n<internal_states>state</internal_states><!-- GFX_END --> after',
      ),
    ).toBe(ff5Fixture.expected.contextSaverDepth2);
  });

  it('rejects invalid imported regex configuration with the owning script name', () => {
    expect(() =>
      migrateLegacyOaiPreset({
        chat_completion_source: 'openai',
        reverse_proxy: '',
        proxy_password: '',
        extensions: { regex_scripts: [{ scriptName: 'Broken FF5 script', findRegex: '/[/g', placement: [2] }] },
      }),
    ).toThrow('Broken FF5 script');

    expect(() =>
      normalizeRegexScript({ scriptName: 'Bad depth', findRegex: '/x/g', placement: [2], minDepth: -1 }),
    ).toThrow('Bad depth');
    expect(() => normalizeRegexScript({ scriptName: 'Bad flags', findRegex: '/x/invalid', placement: [2] })).toThrow(
      'Bad flags',
    );
    expect(() => normalizeRegexScript({ scriptName: 'Bad placement', findRegex: '/x/g', placement: [99] })).toThrow(
      'Bad placement',
    );
  });
});

describe('display regex execution', () => {
  it('selects independent passes and preserves serialized order', () => {
    const scripts = [
      normalizeRegexScript({
        scriptName: 'prompt-only',
        findRegex: '/foo/g',
        replaceString: 'prompt',
        placement: [2],
        promptOnly: true,
        markdownOnly: false,
      }),
      normalizeRegexScript({
        scriptName: 'display-only',
        findRegex: '/foo/g',
        replaceString: 'display',
        placement: [2],
        promptOnly: false,
        markdownOnly: true,
      }),
      normalizeRegexScript({
        scriptName: 'both',
        findRegex: '/display|prompt/g',
        replaceString: 'both',
        placement: [2],
        promptOnly: true,
        markdownOnly: true,
      }),
      normalizeRegexScript({
        scriptName: 'neither',
        findRegex: '/both/g',
        replaceString: 'neither',
        placement: [2],
        promptOnly: false,
        markdownOnly: false,
      }),
      normalizeRegexScript({
        scriptName: 'serialized-next',
        findRegex: '/both/g',
        replaceString: 'ordered',
        placement: [2],
        promptOnly: false,
        markdownOnly: true,
      }),
    ];

    expect(applyPromptRegexScripts('foo', scripts, { placement: 'assistant', depth: 0 })).toBe('both');
    expect(applyMarkdownRegexScripts('foo', scripts, { placement: 'assistant', depth: 0 })).toBe('ordered');
  });

  it('applies placement and inclusive depth selection before replacement', () => {
    const script = normalizeRegexScript({
      scriptName: 'depth-limited-display',
      findRegex: '/foo/g',
      replaceString: 'bar',
      placement: [2],
      promptOnly: false,
      markdownOnly: true,
      minDepth: 1,
      maxDepth: 2,
    });

    expect(applyMarkdownRegexScripts('foo', [script], { placement: 'assistant', depth: 1 })).toBe('bar');
    expect(applyMarkdownRegexScripts('foo', [script], { placement: 'assistant', depth: 2 })).toBe('bar');
    expect(applyMarkdownRegexScripts('foo', [script], { placement: 'assistant', depth: 0 })).toBe('foo');
    expect(applyMarkdownRegexScripts('foo', [script], { placement: 'assistant', depth: 3 })).toBe('foo');
    expect(applyMarkdownRegexScripts('foo', [script], { placement: 'user', depth: 1 })).toBe('foo');
  });

  it('transforms representative imported FF5 display text into HTML', () => {
    const migrated = migrateLegacyOaiPreset(ff5Fixture);
    const source = [
      'Alice ↔ Bob | BOND: +4 | SPARKS: 3 | GRUDGE: 1',
      '- <b>Threat</b>',
      '<details><summary>INTERNAL STATES</summary><p>State</p></details>',
      '<details><summary>QUESTS</summary><p>Quest</p></details>',
    ].join('\n');
    const result = applyMarkdownRegexScripts(source, migrated.regex_scripts, {
      placement: 'assistant',
      depth: 0,
    });

    expect(result).toContain('background:rgba(24,24,37,0.8)');
    expect(result).toContain('Alice <span style="color:#74c7ec;margin:0 8px;">⟷</span> Bob');
    expect(result).toContain('- <b style="color:#f9e2af;font-weight:600');
    expect(result).toContain('background:rgba(20,20,30,0.4)');
    expect(result).toContain('</details><details style="background:rgba(203,166,247,0.05)');
  });
});

describe('prompt-only regex execution', () => {
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

  it('supports captures, {{match}}, trim strings, independent selectors, placement, order, and disabled scripts', async () => {
    const scripts = [
      normalizeRegexScript({
        scriptName: 'first',
        findRegex: '/(foo)/g',
        replaceString: '{{match}}-$1',
        trimStrings: ['o'],
        placement: [2],
        promptOnly: true,
        markdownOnly: false,
      }),
      normalizeRegexScript({
        scriptName: 'second',
        findRegex: '/foo/g',
        replaceString: 'BAR',
        placement: [2],
        promptOnly: true,
        markdownOnly: true,
      }),
      normalizeRegexScript({
        scriptName: 'display-only',
        findRegex: '/BAR/g',
        replaceString: 'DISPLAY',
        placement: [2],
        promptOnly: false,
        markdownOnly: true,
      }),
      normalizeRegexScript({
        scriptName: 'neither',
        findRegex: '/BAR/g',
        replaceString: 'NEITHER',
        placement: [2],
        promptOnly: false,
        markdownOnly: false,
      }),
      normalizeRegexScript({
        scriptName: 'disabled',
        findRegex: '/BAR/g',
        replaceString: 'DISABLED',
        placement: [2],
        promptOnly: true,
        markdownOnly: false,
        enabled: false,
      }),
      normalizeRegexScript({
        scriptName: 'user-only',
        findRegex: '/user/g',
        replaceString: 'USER',
        placement: [1],
        promptOnly: true,
        markdownOnly: false,
      }),
    ];
    const messages = await build(scripts, [message('User', 'user', true), message('Char', 'foo')]).build();

    expect(messages.map((item) => item.content)).toContain('USER');
    expect(messages.map((item) => item.content)).toContain('f-f');
    expect(messages.map((item) => item.content)).not.toContain('DISPLAY');
    expect(messages.map((item) => item.content)).not.toContain('NEITHER');
    expect(messages.map((item) => item.content)).not.toContain('DISABLED');
    expect(runRegexScript(scripts[0], 'foo')).toBe('f-f');
  });

  it('filters history by newest-first depth, preserves source content, applies Context Saver at depth 2, and counts transformed content', async () => {
    const fixtureSettings = migrateLegacyOaiPreset(ff5Fixture);
    const history = [
      message('Char', 'old <!-- GFX_START -->\n<internal_states>old</internal_states><!-- GFX_END -->'),
      message('User', 'middle <!-- GFX_START -->\n<internal_states>middle</internal_states><!-- GFX_END -->', true),
      message('Char', 'new <!-- IMG_PROMPT: remove -->'),
    ];
    const messages = await build(fixtureSettings.regex_scripts, history, {
      ...settings(fixtureSettings.regex_scripts),
      max_context: 200,
    }).build();

    expect(messages.map((item) => item.content)).toContain('old ');
    expect(messages.map((item) => item.content)).toContain('new ');
    expect(messages.map((item) => item.content)).toContain(
      'middle <!-- GFX_START -->\n<internal_states>middle</internal_states><!-- GFX_END -->',
    );
    expect(messages.map((item) => item.content)).not.toContain('old <!-- GFX_START -->');
    expect(history[0].mes).toContain('<internal_states>old</internal_states>');
    expect(history[2].mes).toContain('IMG_PROMPT');
  });

  it('applies prompt-only scripts once to depth-injected content and keeps display-only scripts out of the API payload', async () => {
    (WorldInfoProcessor as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return {
        process: vi.fn().mockResolvedValue({
          worldInfoBefore: '',
          worldInfoAfter: '',
          anBefore: [],
          anAfter: [],
          emBefore: [],
          emAfter: [],
          depthEntries: [{ depth: 1, role: 'assistant', entries: ['depth foo'] }],
          outletEntries: {},
          triggeredEntries: {},
        }),
      };
    });
    const scripts = [
      normalizeRegexScript({
        scriptName: 'depth',
        findRegex: '/foo/g',
        replaceString: 'bar',
        placement: ['assistant'],
        promptOnly: true,
        markdownOnly: false,
        minDepth: 1,
        maxDepth: 1,
      }),
      normalizeRegexScript({
        scriptName: 'display',
        findRegex: '/bar/g',
        replaceString: 'display',
        placement: ['assistant'],
        promptOnly: false,
        markdownOnly: true,
      }),
    ];
    const messages = await build(scripts, [message('Char', 'history foo')]).build();

    expect(messages.map((item) => item.content)).toContain('depth bar');
    expect(messages.map((item) => item.content)).toContain('history foo');
    expect(messages.map((item) => item.content)).not.toContain('display');
  });

  it('budgets the transformed API content rather than the stored source content', async () => {
    const scripts = [
      normalizeRegexScript({
        scriptName: 'budget stripper',
        findRegex: '/REMOVE/g',
        replaceString: '',
        placement: [2],
        promptOnly: true,
        markdownOnly: false,
      }),
    ];
    const storedMessage = message('Char', 'REMOVE12345');
    const messages = await build(scripts, [storedMessage], {
      ...settings(scripts),
      max_context: 5,
    }).build();

    expect(messages.map((item) => item.content)).toContain('12345');
    expect(storedMessage.mes).toBe('REMOVE12345');
  });
});
