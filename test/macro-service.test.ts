import { describe, expect, test } from 'vitest';
import { macroService, type MacroContextData } from '../src/services/macro-service';
import type { Character, Persona } from '../src/types';

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
});
