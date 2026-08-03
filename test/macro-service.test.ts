import { describe, expect, test } from 'vitest';
import { MacroEvaluationError, macroService, type MacroContextData } from '../src/services/macro-service';
import type { Character, ChatMessage, Persona } from '../src/types';

const mockCharacter: Character = {
  name: 'Alice',
  avatar: 'alice.png',
  description: 'A friendly AI named {{char}}.',
  personality: 'Kind',
  scenario: 'In a lab',
  mes_example: 'Hello!',
  first_mes: 'Hi user.',
};

const mockPersona: Persona = {
  name: 'Bob',
  avatarId: 'bob.png',
  description: 'A human user.',
  lorebooks: [],
  connections: [],
};

const context: MacroContextData = {
  characters: [mockCharacter],
  persona: mockPersona,
};

describe('MacroService', () => {
  test('replaces standard character macros', () => {
    const template = '{{char}} is cool';
    const result = macroService.process(template, context);
    expect(result).toBe('Alice is cool');
  });

  test('replaces standard user macros', () => {
    const template = '{{user}} says hello.';
    const result = macroService.process(template, context);
    expect(result).toBe('Bob says hello.');
  });

  test('handles nested macros', () => {
    // Description contains {{char}}, which should resolve to Alice
    const template = 'Description: {{description}}';
    const result = macroService.process(template, context);
    expect(result).toBe('Description: A friendly AI named Alice.');
  });

  test('prevents infinite recursion', () => {
    // {{char}} resolves to "Alice". If we had a property that resolved to itself:
    const recursiveChar = { ...mockCharacter, name: '{{char}}' };
    const badContext = { ...context, characters: [recursiveChar] };

    // Should stop after max recursion depth (10)
    // 1. {{char}} -> {{char}}
    // ...
    const result = macroService.process('{{char}}', badContext);
    expect(result).toBe('{{char}}');
  });

  test('uses activeCharacter for context override', () => {
    const char2 = { ...mockCharacter, name: 'Eve' };
    const overrideContext: MacroContextData = {
      characters: [mockCharacter, char2],
      persona: mockPersona,
      activeCharacter: char2,
    };

    // Should use Eve instead of Alice
    const result = macroService.process('My name is {{char}}', overrideContext);
    expect(result).toBe('My name is Eve');
  });

  describe('Comments', () => {
    test('removes simple comments', () => {
      const template = '{{// This is a comment }}Visible';
      const result = macroService.process(template, context);
      expect(result).toBe('Visible');
    });

    test('removes multiline comments', () => {
      const template = 'Visible{{// \n multiline \n comment }}';
      const result = macroService.process(template, context);
      expect(result).toBe('Visible');
    });

    test('removes comments mixed with macros', () => {
      const template = '{{char}} {{// comment }} says hi';
      const result = macroService.process(template, context);
      expect(result).toBe('Alice  says hi');
    });

    test('removes comments that contain macros (stops at first }})', () => {
      // Logic check: The comment parser is non-greedy and stops at first }}
      // So {{// {{char}} }} -> removed "{{// {{char}}" -> remains "}}"
      const template = '{{// comment with {{char}} inside }}';
      const result = macroService.process(template, context);
      expect(result).toBe(' inside }}');
    });
  });

  describe('Additional Macros', () => {
    test('uses additional macros when provided', () => {
      const contextWithAdditional: MacroContextData = {
        ...context,
        additionalMacros: { customMacro: 'CustomValue' },
      };
      const template = 'Custom: {{customMacro}}';
      const result = macroService.process(template, contextWithAdditional);
      expect(result).toBe('Custom: CustomValue');
    });

    test('additional macros override built-in macros', () => {
      const contextWithAdditional: MacroContextData = {
        ...context,
        additionalMacros: { char: 'OverriddenName' },
      };
      const template = '{{char}} is here';
      const result = macroService.process(template, contextWithAdditional);
      expect(result).toBe('OverriddenName is here');
    });

    test('combines built-in and additional macros', () => {
      const contextWithAdditional: MacroContextData = {
        ...context,
        additionalMacros: { location: 'Tokyo' },
      };
      const template = '{{user}} and {{char}} are in {{location}}';
      const result = macroService.process(template, contextWithAdditional);
      expect(result).toBe('Bob and Alice are in Tokyo');
    });

    test('works without additional macros', () => {
      const template = '{{char}} says hello';
      const result = macroService.process(template, context);
      expect(result).toBe('Alice says hello');
    });

    test('preserves Handlebars blocks and helpers', () => {
      const result = macroService.process(
        '{{#if schema}}{{join names ", "}}{{/if}}|{{#each (slice chat -1)}}{{add @index 1}}:{{this.mes}}{{/each}}|{{time}}',
        {
          ...context,
          chatHistory: [createMessage('older', true), createMessage('latest', false)],
          additionalMacros: { schema: '{}', names: ['one', 'two'] },
        },
      );

      expect(result).toMatch(/^one, two\|1:latest\|\d{1,2}:\d{2}(?: (AM|PM))?$/);
    });

    test('resolves bare fields against each block context without allowing unknown top-level macros', () => {
      const result = macroService.process(
        '{{#each data.characters}}{{name}}:{{hair}};{{/each}}|{{#with data.summary}}{{name}}:{{hair}}{{/with}}',
        {
          ...context,
          additionalMacros: {
            data: {
              characters: [
                { name: 'Alice', hair: 'long' },
                { name: 'Eve', hair: 'short' },
              ],
              summary: { name: 'Summary', hair: 'mixed' },
            },
          },
        },
      );

      expect(result).toBe('Alice:long;Eve:short;|Summary:mixed');
      expect(() => macroService.process('{{name}}', context)).toThrowError(MacroEvaluationError);
    });
  });

  describe('Raw Blocks', () => {
    test('preserves macros inside raw blocks', () => {
      const template = '{{#raw}}{{char}} and {{user}}{{/raw}}';
      const result = macroService.process(template, context);
      expect(result).toBe('{{char}} and {{user}}');
    });

    test('processes macros outside raw blocks', () => {
      const template = '{{char}} says: {{#raw}}Hello {{user}}{{/raw}}';
      const result = macroService.process(template, context);
      expect(result).toBe('Alice says: Hello {{user}}');
    });

    test('handles multiple raw blocks', () => {
      const template = '{{#raw}}{{char}}{{/raw}} and {{user}} with {{#raw}}{{scenario}}{{/raw}}';
      const result = macroService.process(template, context);
      expect(result).toBe('{{char}} and Bob with {{scenario}}');
    });

    test('preserves raw blocks through recursive processing', () => {
      const contextWithInput: MacroContextData = {
        ...context,
        additionalMacros: { input: '{{#raw}}{{char}}{{/raw}}' },
      };
      const template = 'Text: {{input}}';
      const result = macroService.process(template, contextWithInput);
      expect(result).toBe('Text: {{char}}');
    });

    test('handles nested content in raw blocks', () => {
      const template = '{{#raw}}Write as {{char}} in third-person{{/raw}}';
      const result = macroService.process(template, context);
      expect(result).toBe('Write as {{char}} in third-person');
    });

    test('raw blocks work with comments', () => {
      const template = '{{// comment }}{{#raw}}{{char}}{{/raw}} is cool';
      const result = macroService.process(template, context);
      expect(result).toBe('{{char}} is cool');
    });

    test('empty raw blocks', () => {
      const template = '{{#raw}}{{/raw}}text';
      const result = macroService.process(template, context);
      expect(result).toBe('text');
    });

    test('raw blocks with whitespace', () => {
      const template = '{{#raw}}  {{char}}  {{/raw}}';
      const result = macroService.process(template, context);
      expect(result).toBe('  {{char}}  ');
    });
  });

  describe('T001 registered macros', () => {
    test('resolves active identity, text, group, whitespace, and chat macros', () => {
      const char2 = { ...mockCharacter, name: 'Eve', scenario: 'Elsewhere', personality: 'Bold' };
      const chatHistory = [
        { ...createMessage('first', true), name: 'Bob' },
        { ...createMessage('reply', false), name: 'Alice' },
        { ...createMessage('latest', true), name: 'Bob' },
      ];
      const result = macroService.process(
        '{{user}}/{{char}}/{{group}}/{{scenario}}/{{personality}}/{{lastMessage}}/{{lastUserMessage}}/{{lastCharMessage}}',
        {
          ...context,
          characters: [mockCharacter, char2],
          activeCharacter: char2,
          group: [mockCharacter, char2],
          chatHistory,
        },
      );

      expect(result).toBe('Bob/Eve/Alice, Eve/Elsewhere/Bold/latest/latest/reply');
      expect(macroService.process('a\r\n{{trim}}\n b', context)).toBe('a b');
      expect(macroService.process('a\r\n\n\r\n{{trim}}\n\r\n\n b', context)).toBe('a b');
      expect(macroService.process('a \r\n{{trim}}\n b', context)).toBe('a  b');
      expect(macroService.process('{{newline}}{{noop}}', context)).toBe('\n');
    });

    test('persists variables in metadata and isolates chats', () => {
      const firstMetadata = { integrity: 'first' };
      const firstSession = macroService.createEvaluationSession({ ...context, chatMetadata: firstMetadata });
      expect(firstSession.evaluate('{{setvar::score::2}}{{addvar::score::3}}{{incvar::score}}{{getvar::score}}')).toBe(
        '66',
      );
      expect(firstMetadata.extra).toBeUndefined();
      expect(firstSession.commit()).toBe(true);
      expect(firstMetadata.extra?.variables).toEqual({ score: 6 });

      const reloadedSession = macroService.createEvaluationSession({ ...context, chatMetadata: firstMetadata });
      expect(reloadedSession.evaluate('{{getvar::score}}')).toBe('6');

      const secondMetadata = { integrity: 'second' };
      const secondSession = macroService.createEvaluationSession({ ...context, chatMetadata: secondMetadata });
      expect(secondSession.evaluate('{{getvar::score}}')).toBe('');
    });

    test('converts numeric variable strings when read', () => {
      const metadata = { integrity: 'numeric-read', extra: { variables: { score: '007' } } };
      const session = macroService.createEvaluationSession({ ...context, chatMetadata: metadata });

      expect(session.evaluate('{{getvar::score}}')).toBe('7');
      expect(session.getVariable('score')).toBe('007');
    });

    test('uses getvar defaults only for missing variables and preserves embedded delimiters', () => {
      const session = macroService.createEvaluationSession({
        ...context,
        chatMetadata: { integrity: 'getvar-defaults', extra: { variables: { existing: 'stored' } } },
      });

      expect(session.evaluate('{{getvar::missing::fallback}}')).toBe('fallback');
      expect(session.evaluate('{{getvar::existing::fallback}}')).toBe('stored');
      expect(session.evaluate('{{getvar::notes::- [R] No active notes. :: more}}')).toBe(
        '- [R] No active notes. :: more',
      );
    });

    test('uses an injected random source for dice', () => {
      const result = macroService.process('{{roll::2d6+1}}', { ...context, random: () => 0.5 });
      expect(result).toBe('9');
    });

    test('preserves raw setvar values while trimming the variable name', () => {
      const metadata = { integrity: 'raw-setvar' };
      const session = macroService.createEvaluationSession({ ...context, chatMetadata: metadata });
      const value = '  leading :: and trailing  ';

      expect(session.evaluate(`{{setvar:: score ::${value}}}{{getvar::score}}`)).toBe(value);
      session.commit();

      expect(metadata.extra?.variables).toEqual({ score: value });
    });

    test('requires the exact arity for every variable macro', () => {
      const missingArguments = [
        ['getvar', '{{getvar}}'],
        ['incvar', '{{incvar}}'],
        ['decvar', '{{decvar}}'],
        ['setvar', '{{setvar}}'],
        ['setvar', '{{setvar::name}}'],
        ['addvar', '{{addvar}}'],
        ['addvar', '{{addvar::name}}'],
      ];
      const surplusArguments = [
        ['incvar', '{{incvar::name::extra}}'],
        ['decvar', '{{decvar::name::extra}}'],
      ];

      for (const [macroName, expression] of [...missingArguments, ...surplusArguments]) {
        expect(() => macroService.process(expression, context)).toThrowError(new RegExp(`Macro '${macroName}':`));
      }
    });

    test('preserves embedded delimiters and whitespace in setvar and addvar values', () => {
      const session = macroService.createEvaluationSession({ ...context, chatMetadata: { integrity: 'raw-values' } });
      const value = '  first :: second  ';

      expect(session.evaluate(`{{setvar:: name ::${value}}}{{addvar::name:: ::third ::  }}{{getvar::name}}`)).toBe(
        '  first :: second   ::third ::  ',
      );
    });

    test('does not commit or retain staged variables after a failed evaluation', () => {
      const metadata = { integrity: 'failed-session', extra: { variables: { existing: 'old' } } };
      const session = macroService.createEvaluationSession({ ...context, chatMetadata: metadata });

      expect(() => session.evaluate('{{setvar::existing::new}}{{incvar::existing::extra}}')).toThrowError(
        /Macro 'incvar':/,
      );
      expect(session.getVariable('existing')).toBe('old');
      expect(session.commit()).toBe(false);
      expect(metadata.extra?.variables).toEqual({ existing: 'old' });
    });

    test('reports unknown macros and invalid dice formulas explicitly', () => {
      expect(() => macroService.process('{{unknown}}', context)).toThrowError(MacroEvaluationError);
      expect(() => macroService.process('{{roll::not-a-dice}}', context)).toThrowError(/roll.*Invalid dice formula/);
      expect(() => macroService.process('{{setvar}}', context)).toThrowError(/setvar.*Variable name is required/);
      expect(() => macroService.process('{{roll::1d}}', context)).toThrowError(/roll.*Invalid dice formula/);
    });

    test('rejects surplus arguments for no-argument macros while preserving valid calls', () => {
      expect(() => macroService.process('{{newline::x}}', context)).toThrowError(
        /Macro 'newline': Does not accept arguments/,
      );
      expect(macroService.process('{{newline}}', context)).toBe('\n');
      expect(macroService.process('{{roll::1d1}}', { ...context, random: () => 0 })).toBe('1');
    });

    test('does not mutate variables when a session is only evaluated', () => {
      const metadata = { integrity: 'preview' };
      const session = macroService.createEvaluationSession({ ...context, chatMetadata: metadata });
      expect(session.evaluate('{{incvar::preview}}')).toBe('1');
      expect(metadata.extra).toBeUndefined();
    });
  });
});

function createMessage(mes: string, isUser: boolean): ChatMessage {
  return {
    name: isUser ? 'Bob' : 'Alice',
    mes,
    send_date: 'now',
    is_user: isUser,
    is_system: false,
    original_avatar: '',
    swipes: [],
    swipe_info: [],
    swipe_id: 0,
    extra: {},
  };
}
