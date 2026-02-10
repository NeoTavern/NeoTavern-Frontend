import { describe, expect, it } from 'vitest';
import { ensureAdditionalPropertiesFalse } from '../src/api/generation';

describe('ensureAdditionalPropertiesFalse', () => {
  it('should add additionalProperties: false to simple object schema', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    };

    const result = ensureAdditionalPropertiesFalse(schema);

    expect(result.additionalProperties).toBe(false);
    expect(result.properties.name).toEqual({ type: 'string' });
    expect(result.properties.age).toEqual({ type: 'number' });
  });

  it('should recursively add additionalProperties: false to nested object schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: {
              type: 'object',
              properties: {
                street: { type: 'string' },
                city: { type: 'string' },
              },
            },
          },
        },
      },
    };

    const result = ensureAdditionalPropertiesFalse(schema);

    expect(result.additionalProperties).toBe(false);
    expect(result.properties.user.additionalProperties).toBe(false);
    expect(result.properties.user.properties.address.additionalProperties).toBe(false);
  });

  it('should handle array schemas with object items', () => {
    const schema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              value: { type: 'number' },
            },
          },
        },
      },
    };

    const result = ensureAdditionalPropertiesFalse(schema);

    expect(result.additionalProperties).toBe(false);
    expect(result.properties.items.items.additionalProperties).toBe(false);
  });

  it('should handle anyOf schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        data: {
          anyOf: [
            {
              type: 'object',
              properties: {
                text: { type: 'string' },
              },
            },
            {
              type: 'object',
              properties: {
                number: { type: 'number' },
              },
            },
          ],
        },
      },
    };

    const result = ensureAdditionalPropertiesFalse(schema);

    expect(result.additionalProperties).toBe(false);
    expect(result.properties.data.anyOf[0].additionalProperties).toBe(false);
    expect(result.properties.data.anyOf[1].additionalProperties).toBe(false);
  });

  it('should handle oneOf schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        data: {
          oneOf: [
            {
              type: 'object',
              properties: {
                text: { type: 'string' },
              },
            },
            {
              type: 'object',
              properties: {
                number: { type: 'number' },
              },
            },
          ],
        },
      },
    };

    const result = ensureAdditionalPropertiesFalse(schema);

    expect(result.additionalProperties).toBe(false);
    expect(result.properties.data.oneOf[0].additionalProperties).toBe(false);
    expect(result.properties.data.oneOf[1].additionalProperties).toBe(false);
  });

  it('should handle allOf schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        data: {
          allOf: [
            {
              type: 'object',
              properties: {
                text: { type: 'string' },
              },
            },
            {
              type: 'object',
              properties: {
                number: { type: 'number' },
              },
            },
          ],
        },
      },
    };

    const result = ensureAdditionalPropertiesFalse(schema);

    expect(result.additionalProperties).toBe(false);
    expect(result.properties.data.allOf[0].additionalProperties).toBe(false);
    expect(result.properties.data.allOf[1].additionalProperties).toBe(false);
  });

  it('should not mutate the original schema', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    };

    const original = JSON.parse(JSON.stringify(schema));
    ensureAdditionalPropertiesFalse(schema);

    expect(schema).toEqual(original);
  });

  it('should handle non-object types without errors', () => {
    expect(ensureAdditionalPropertiesFalse({ type: 'string' })).toEqual({ type: 'string' });
    expect(ensureAdditionalPropertiesFalse({ type: 'number' })).toEqual({ type: 'number' });
    expect(ensureAdditionalPropertiesFalse({ type: 'boolean' })).toEqual({ type: 'boolean' });
  });

  it('should handle null and undefined', () => {
    expect(ensureAdditionalPropertiesFalse(null)).toBe(null);
    expect(ensureAdditionalPropertiesFalse(undefined)).toBe(undefined);
  });

  it('should preserve existing additionalProperties if already false', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      additionalProperties: false,
    };

    const result = ensureAdditionalPropertiesFalse(schema);

    expect(result.additionalProperties).toBe(false);
  });

  it('should handle complex nested structure with arrays and objects', () => {
    const schema = {
      type: 'object',
      properties: {
        justification: {
          type: 'string',
          description: 'A brief explanation',
        },
        response: {
          type: 'string',
          description: 'The full, rewritten text',
        },
        toolCalls: {
          type: 'array',
          description: 'Optional tool calls',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'The name of the tool function',
              },
              arguments: {
                type: 'string',
                description: 'A JSON string of arguments',
              },
            },
            required: ['name', 'arguments'],
          },
        },
      },
      required: [],
    };

    const result = ensureAdditionalPropertiesFalse(schema);

    expect(result.additionalProperties).toBe(false);
    expect(result.properties.toolCalls.items.additionalProperties).toBe(false);
    expect(result.properties.toolCalls.items.required).toEqual(['name', 'arguments']);
  });

  it('should handle schema with enum in nested object', () => {
    const schema = {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fieldId: {
                type: 'string',
                enum: ['field1', 'field2', 'field3'],
              },
              newValue: {
                type: 'string',
              },
            },
            required: ['fieldId', 'newValue'],
          },
        },
      },
    };

    const result = ensureAdditionalPropertiesFalse(schema);

    expect(result.additionalProperties).toBe(false);
    expect(result.properties.changes.items.additionalProperties).toBe(false);
    expect(result.properties.changes.items.properties.fieldId.enum).toEqual(['field1', 'field2', 'field3']);
  });
});
