import { describe, expect, test } from 'vitest';
import type { Character, ChatMessage, ExtensionAPI, Persona, WorldInfoBook } from '../../../../types';
import {
  buildQuickEditMessages,
  resolveContext,
  runCommandAndApply,
  type QuickEditTarget,
  type ResolvedQuickEditContext,
} from '../quick-edit';
import { renderReferencedBlock } from '../references';
import { fakeDataApi } from '../test-support/fake-data-api';
import {
  createDefaultSettings,
  migrateAssistantSettings,
  type AssistantCommand,
  type AssistantSettings,
} from '../types';

function fakeApi(options: { history?: Pick<ChatMessage, 'name' | 'mes'>[]; characters?: Partial<Character>[] } = {}) {
  const characters = (options.characters ?? []) as Character[];
  return {
    chat: { getHistory: () => (options.history ?? []) as ChatMessage[] },
    character: {
      get: (avatar: string) => characters.find((character) => character.avatar === avatar) ?? null,
      getActives: () => characters,
    },
    persona: { getActive: () => ({ name: 'Alex' }) as Persona },
    worldInfo: { getBook: async () => null as WorldInfoBook | null },
  };
}

function userContents(messages: ReturnType<typeof buildQuickEditMessages>): string[] {
  return messages.filter((message) => message.role === 'user').map((message) => message.content as string);
}

const none: ResolvedQuickEditContext = { kind: 'none' };

describe('quick edit context', () => {
  test('chat context takes exactly the N messages before beforeIndex', async () => {
    const history = Array.from({ length: 6 }, (_, index) => ({ name: 'A', mes: `m${index}` }));
    const context = await resolveContext(fakeApi({ history }), { kind: 'chat', beforeIndex: 4 }, 2);

    expect(context.kind === 'chat' && context.messages.map((message) => message.mes)).toEqual(['m2', 'm3']);
  });

  test('character context leaves out the edited field', async () => {
    const character = {
      avatar: 'seraphina.png',
      name: 'Seraphina',
      description: 'DESC',
      personality: 'PERS',
      scenario: 'SCEN',
      first_mes: 'FIRST',
    };
    const context = await resolveContext(
      fakeApi({ characters: [character] }),
      { kind: 'character', avatar: 'seraphina.png', field: 'scenario' },
      3,
    );
    const [user] = userContents(buildQuickEditMessages({ label: 'scenario', text: '' }, context, 'Write it'));

    expect(user).toContain('Seraphina');
    expect(user).toContain('DESC');
    expect(user).toContain('PERS');
    expect(user).toContain('FIRST');
    expect(user).not.toContain('SCEN');
  });
});

describe('buildQuickEditMessages', () => {
  test('text containing macros arrives verbatim', () => {
    const text = '{{char}} smiles at {{user}}. *waves*';
    const messages = buildQuickEditMessages({ label: 'message', text }, none, 'Fix grammar');

    expect(userContents(messages)[0]).toContain('```\n' + text + '\n```');
  });

  test('empty text asks for new text and sends no fenced block', () => {
    const [user] = userContents(buildQuickEditMessages({ label: 'alternate greeting', text: '' }, none, 'A greeting'));

    expect(user).toContain('Write new text for this field');
    expect(user).not.toContain('```');
  });

  test('mentioned content comes after the context block and ahead of the instruction', async () => {
    const data = fakeDataApi({
      characters: [{ avatar: 'hazel.png', name: 'Hazel', first_mes: 'HAZEL_GREETING' }],
      history: [{ name: 'Bot', mes: 'RECENT_MESSAGE' }],
    });
    const referenced = await renderReferencedBlock(data, [{ kind: 'character', avatar: 'hazel.png', label: 'Hazel' }]);
    const context = await resolveContext(
      fakeApi({ history: [{ name: 'Bot', mes: 'RECENT_MESSAGE' }] }),
      {
        kind: 'chat',
        beforeIndex: 1,
      },
      5,
    );

    const [first] = userContents(
      buildQuickEditMessages({ label: 'message', text: 'Hi' }, context, { instruction: 'Match her tone', referenced }),
    );
    const followUp = buildQuickEditMessages(
      { label: 'message', text: 'Hi' },
      context,
      {
        instruction: 'Shorter',
        referenced,
      },
      [{ instruction: 'Fix typos', output: 'Hi!' }],
    ).at(-1)!.content as string;

    expect(first.indexOf('RECENT_MESSAGE')).toBeLessThan(first.indexOf('HAZEL_GREETING'));
    expect(first.indexOf('HAZEL_GREETING')).toBeLessThan(first.indexOf('Instruction: Match her tone'));
    expect(followUp.indexOf('HAZEL_GREETING')).toBeLessThan(followUp.indexOf('Shorter'));
  });

  test('a follow-up appends after the earlier turns', () => {
    const messages = buildQuickEditMessages({ label: 'message', text: 'Original' }, none, 'shorter', [
      { instruction: 'Fix typos', output: 'First' },
      { instruction: 'More formal', output: 'Second' },
    ]);

    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(messages[1].content).toContain('Fix typos');
    expect(messages[1].content).toContain('Original');
    expect(messages[2].content).toContain('First');
    expect(messages[3].content).toContain('More formal');
    expect(messages[4].content).toContain('Second');
    expect(messages[5].content).toBe('Revise your latest version: shorter');
  });
});

describe('migrateAssistantSettings', () => {
  test('fills defaults from nothing', () => {
    expect(migrateAssistantSettings({})).toEqual(createDefaultSettings());
    expect(migrateAssistantSettings().commands.map((command) => command.name)).toEqual(['grammar', 'concise']);
  });

  test('keeps existing commands untouched', () => {
    const commands: AssistantCommand[] = [
      { id: 'x', name: 'translate', prompt: 'To French', connectionProfile: 'cheap', pinned: true, autoAccept: true },
    ];

    const migrated = migrateAssistantSettings({ commands, contextMessageCount: 7 });

    expect(migrated.commands).toEqual(commands);
    expect(migrated.contextMessageCount).toBe(7);
    expect(migrated.lastCommandByTarget).toEqual({});
  });
});

describe('runCommandAndApply', () => {
  const command: AssistantCommand = {
    id: 'translate',
    name: 'translate',
    prompt: 'Translate to English.',
    connectionProfile: 'profile-1',
    pinned: true,
    autoAccept: true,
  };

  function autoApplyApi(generate: () => Promise<{ content: string }>) {
    const listeners: Record<string, (() => void)[]> = {};
    const settings = createDefaultSettings();
    const toasts: string[] = [];
    const api = {
      ...fakeApi({ history: [{ name: 'Bot', mes: 'hola' }] }),
      i18n: { t: (key: string) => key },
      settings: {
        get: (path?: keyof typeof settings) => (path ? settings[path] : settings),
        getGlobal: () => '',
        set: (path: keyof typeof settings, value: never) => (settings[path] = value),
        save: () => {},
      },
      events: {
        on: (event: string, listener: () => void) => {
          (listeners[event] ??= []).push(listener);
          return () => (listeners[event] = listeners[event].filter((other) => other !== listener));
        },
      },
      ui: { showToast: (message: string) => toasts.push(message) },
      llm: { generate },
    };
    const emit = (event: string) => listeners[event]?.forEach((listener) => listener());
    return { api: api as unknown as ExtensionAPI<AssistantSettings>, emit, settings, toasts };
  }

  function messageTarget(apply: (text: string) => void): QuickEditTarget {
    return {
      identifier: 'chat.message',
      label: 'Message',
      text: 'hola',
      context: { kind: 'chat', beforeIndex: 0 },
      apply,
    };
  }

  test('applies the result and records the command', async () => {
    const { api, settings } = autoApplyApi(async () => ({ content: '```\nhello\n```' }));
    const applied: string[] = [];

    await runCommandAndApply(
      api,
      messageTarget((text) => applied.push(text)),
      command,
    );

    expect(applied).toEqual(['hello']);
    expect(settings.lastCommandByTarget['chat.message']).toBe('translate');
  });

  test('a chat change during the run cancels the apply', async () => {
    const { api, emit, settings } = autoApplyApi(async () => {
      emit('chat:entered');
      return { content: '```\nhello\n```' };
    });
    const applied: string[] = [];

    await runCommandAndApply(
      api,
      messageTarget((text) => applied.push(text)),
      command,
    );

    expect(applied).toEqual([]);
    expect(settings.lastCommandByTarget).toEqual({});
  });

  test('an empty result is not applied', async () => {
    const { api } = autoApplyApi(async () => ({ content: '```\n\n```' }));
    const applied: string[] = [];

    await runCommandAndApply(
      api,
      messageTarget((text) => applied.push(text)),
      command,
    );

    expect(applied).toEqual([]);
  });
});
