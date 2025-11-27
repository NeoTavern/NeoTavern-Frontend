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
  title: 'User',
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

  test('handles global helpers (math/time)', () => {
    const timeRes = macroService.process('{{time}}', context);
    expect(timeRes).not.toBe('{{time}}');
    expect(timeRes.length).toBeGreaterThan(0);

    const randomRes = macroService.process('{{random 10 20}}', context);
    const num = parseInt(randomRes);
    expect(num).toBeGreaterThanOrEqual(10);
    expect(num).toBeLessThanOrEqual(20);
  });

  test('prevents infinite recursion', () => {
    // {{char}} resolves to "Alice". If we had a property that resolved to itself:
    const recursiveChar = { ...mockCharacter, name: '{{char}}' };
    const badContext = { ...context, characters: [recursiveChar] };

    // Should stop after max recursion depth (5)
    // 1. {{char}} -> {{char}}
    // ...
    // 5. {{char}}
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
});
