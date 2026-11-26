import { describe, expect, test } from 'vitest';
import type { Character, ChatMessage, Persona, WorldInfoBook } from '../../../../types';
import { buildQuickEditMessages, resolveContext, type ResolvedQuickEditContext } from '../quick-edit';
import { createDefaultSettings, migrateAssistantSettings, type AssistantCommand } from '../types';

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
