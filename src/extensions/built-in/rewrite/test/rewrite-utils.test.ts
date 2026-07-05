import { describe, expect, test } from 'vitest';
import { reactive } from 'vue';
import type { Character } from '../../../../types';
import type { RewriteField, RewriteSession, RewriteSessionMessage, RewriteSettings } from '../types';
import {
  createRewriteResponseSchema,
  deepToRaw,
  extractCodeBlock,
  formatRewriteCharacterContext,
  formatRewriteContextMessages,
  getChangesFromMessage,
  getInitialRewriteTemplateId,
  getLatestSessionChanges,
  resolveRewriteTemplateArgOverrides,
} from '../utils';

const fields: RewriteField[] = [
  { id: 'description', label: 'Description', value: 'old description' },
  { id: 'personality', label: 'Personality', value: 'old personality' },
];

function message(
  role: RewriteSessionMessage['role'],
  content: RewriteSessionMessage['content'],
  id = `${role}-1`,
): RewriteSessionMessage {
  return { id, role, content, timestamp: 1 };
}

function session(messages: RewriteSessionMessage[], initialFields = fields): RewriteSession {
  return {
    id: 'session-1',
    templateId: 'generic',
    identifier: 'character',
    createdAt: 1,
    updatedAt: 1,
    systemPrompt: '',
    initialFields,
    messages,
  };
}

describe('rewrite utils', () => {
  test('deepToRaw turns reactive nested data into an independent plain copy', () => {
    const source = reactive({
      context: {
        activeCharacter: {
          name: 'Ada',
          tags: ['engineer'],
        },
      },
    });

    const result = deepToRaw(source);
    result.context.activeCharacter.name = 'Grace';

    expect(result).toEqual({
      context: {
        activeCharacter: {
          name: 'Grace',
          tags: ['engineer'],
        },
      },
    });
    expect(source.context.activeCharacter.name).toBe('Ada');
  });

  test('getLatestSessionChanges applies assistant field changes in order', () => {
    const result = getLatestSessionChanges(
      session([
        message('user', 'Please improve these fields.', 'user-1'),
        message(
          'assistant',
          {
            changes: [
              { fieldId: 'description', newValue: 'new description' },
              { fieldId: 'personality', newValue: 'new personality' },
            ],
          },
          'assistant-1',
        ),
        message('assistant', { changes: [{ fieldId: 'description', newValue: 'final description' }] }, 'assistant-2'),
      ]),
    );

    expect(result).toEqual([
      {
        fieldId: 'description',
        label: 'Description',
        oldValue: 'old description',
        newValue: 'final description',
      },
      {
        fieldId: 'personality',
        label: 'Personality',
        oldValue: 'old personality',
        newValue: 'new personality',
      },
    ]);
  });

  test('getLatestSessionChanges supports legacy single-field response messages', () => {
    const initialFields = [{ id: 'description', label: 'Description', value: 'old description' }];

    expect(
      getLatestSessionChanges(session([message('assistant', { response: 'new description' })], initialFields)),
    ).toEqual([
      {
        fieldId: 'description',
        label: 'Description',
        oldValue: 'old description',
        newValue: 'new description',
      },
    ]);
  });

  test('getLatestSessionChanges ignores non-assistant messages and unchanged values', () => {
    const initialFields = [{ id: 'description', label: 'Description', value: 'same description' }];

    expect(
      getLatestSessionChanges(
        session(
          [
            message('user', { response: 'ignored user content' }, 'user-1'),
            message('assistant', { response: 'same description' }, 'assistant-1'),
          ],
          initialFields,
        ),
      ),
    ).toEqual([]);
  });

  test('getChangesFromMessage derives message-local diffs and parses stringified assistant content', () => {
    const messages = [
      message('assistant', { changes: [{ fieldId: 'description', newValue: 'first description' }] }, 'assistant-1'),
      message(
        'assistant',
        JSON.stringify({
          changes: [
            { fieldId: 'description', newValue: 'second description' },
            { fieldId: 'personality', newValue: 'new personality' },
          ],
        }),
        'assistant-2',
      ),
    ];

    expect(getChangesFromMessage(messages[1], 1, messages, fields)).toEqual([
      {
        fieldId: 'description',
        label: 'Description',
        oldValue: 'first description',
        newValue: 'second description',
      },
      {
        fieldId: 'personality',
        label: 'Personality',
        oldValue: 'old personality',
        newValue: 'new personality',
      },
    ]);
  });

  test('extractCodeBlock handles completed, streaming, and plain responses', () => {
    expect(extractCodeBlock('Before\n```ts\nconst value = 1;\n```\nAfter')).toBe('const value = 1;\n');
    expect(extractCodeBlock('```markdown\npartial content')).toBe('partial content');
    expect(extractCodeBlock('plain text')).toBe('plain text');
  });

  test('createRewriteResponseSchema uses response for one field and changes for multiple fields', () => {
    const singleFieldSchema = createRewriteResponseSchema([fields[0]]);
    const multiFieldSchema = createRewriteResponseSchema(fields);

    expect(singleFieldSchema.value.properties.response).toBeDefined();
    expect(singleFieldSchema.value.properties.changes).toBeUndefined();
    expect(multiFieldSchema.value.properties.response).toBeUndefined();
    expect(multiFieldSchema.value.properties.changes.items.properties.fieldId.enum).toEqual([
      'description',
      'personality',
    ]);
  });

  test('formats rewrite context messages and selected character context', () => {
    const history = [
      { name: 'A', mes: 'one' },
      { name: 'B', mes: 'two' },
      { name: 'C', mes: 'three' },
      { name: 'D', mes: 'four' },
    ];
    const characters = [
      {
        name: 'Ada',
        description: 'Inventive.',
        personality: 'Precise.',
        scenario: '',
        mes_example: 'Ada: Let us test it.',
      },
      {
        name: 'Grace',
        description: '',
        personality: '',
        scenario: 'Debugging.',
        mes_example: '',
      },
    ] as Character[];

    expect(formatRewriteContextMessages(history, 2, 3)).toBe('B: two\nC: three');
    expect(formatRewriteContextMessages(history, 0)).toBe('');
    expect(formatRewriteCharacterContext(characters)).toBe(
      [
        'Name: Ada\nDescription: Inventive.\nPersonality: Precise.\nExample Messages: Ada: Let us test it.',
        'Name: Grace\nScenario: Debugging.',
      ].join('\n\n'),
    );
  });

  test('selects initial template and resolves template arg overrides', () => {
    const settings: RewriteSettings = {
      templates: [
        { id: 'generic', name: 'Generic', prompt: '', template: '', sessionPreamble: '' },
        { id: 'character-polisher', name: 'Character', prompt: '', template: '', sessionPreamble: '' },
        { id: 'world-info-refiner', name: 'World Info', prompt: '', template: '', sessionPreamble: '' },
      ],
      defaultConnectionProfile: '',
      lastUsedTemplates: { chat: 'generic' },
      templateOverrides: {},
      disabledTools: [],
    };

    expect(getInitialRewriteTemplateId(settings, 'chat')).toBe('generic');
    expect(getInitialRewriteTemplateId(settings, 'character.description')).toBe('character-polisher');
    expect(getInitialRewriteTemplateId(settings, 'world_info.entry.content')).toBe('world-info-refiner');
    expect(
      resolveRewriteTemplateArgOverrides(
        {
          id: 'generic',
          name: 'Generic',
          prompt: '',
          template: '',
          sessionPreamble: '',
          args: [
            { key: 'includeChar', label: 'Include Character', type: 'boolean', defaultValue: true },
            { key: 'tone', label: 'Tone', type: 'string', defaultValue: 'neutral' },
          ],
        },
        { args: { tone: 'formal' } },
      ),
    ).toEqual({
      includeChar: true,
      tone: 'formal',
    });
  });
});
