import { describe, expect, it } from 'vitest';
import {
  arePortSchemasAssignable,
  projectRequiredProperties,
  propertyPortId,
  schemaAtPath,
  schemaFromConstant,
  schemaValueType,
} from '../../src/extensions/built-in/custom-agents/graph/schema-ports';

describe('custom-agent graph schema port authority', () => {
  it('derives coarse types without serialized value types or general schema algebra', () => {
    expect(schemaValueType({ type: 'integer' })).toBe('NUMBER');
    expect(schemaValueType({ type: ['string', 'null'], enum: ['value'] })).toBe('JSON');
    expect(schemaValueType({ type: 'unsupported', const: 'value' })).toBe('JSON');
    expect(schemaValueType({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe('JSON');
    expect(schemaValueType({ enum: ['a', 'b'] })).toBe('STRING');
    expect(schemaValueType({ enum: [1, 'b'] })).toBe('JSON');
    expect(schemaValueType({ enum: [{ value: 1 }, { value: 2 }] })).toBe('JSON');
    expect(schemaFromConstant(null)).toEqual({});
    expect(schemaFromConstant({ nested: 1 })).toEqual({ type: 'object' });
    expect(schemaFromConstant([1, 2])).toEqual({ type: 'array' });
  });

  it('projects only required top-level properties in lexical RFC6901 port order', () => {
    const schema = {
      type: 'object',
      properties: {
        optional: { type: 'boolean' },
        'z/name': { type: 'string' },
        'a~name': { type: 'object', properties: { deep: { type: 'number' } }, required: ['deep'] },
      },
      required: ['z/name', 'a~name'],
    };
    const projected = projectRequiredProperties(schema);
    expect(projected).toEqual([
      { id: 'property/a~0name', label: 'a~name', schema: schema.properties['a~name'] },
      { id: 'property/z~1name', label: 'z/name', schema: { type: 'string' } },
    ]);
    expect(projectRequiredProperties(projected[0]!.schema)).toEqual([
      { id: 'property/deep', label: 'deep', schema: { type: 'number' } },
    ]);
    expect(propertyPortId('~/')).toBe('property/~0~1');
  });

  it('traverses only explicit properties and homogeneous array items', () => {
    const schema = {
      type: 'object',
      properties: {
        nested: { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: true },
        rows: { type: 'array', items: { type: 'object', properties: { count: { type: 'number' } } } },
      },
    };
    expect(schemaAtPath(schema, 'nested')).toEqual(schema.properties.nested);
    expect(schemaAtPath(schema, 'nested.value')).toEqual({ type: 'string' });
    expect(schemaAtPath(schema, 'nested.unknown')).toEqual({});
    expect(schemaAtPath(schema, 'rows.0.count')).toEqual({ type: 'number' });
    expect(schemaAtPath({ type: 'array', items: [{ type: 'string' }] }, '0')).toEqual({});
  });

  it('uses only the exact coarse assignability relation', () => {
    expect(arePortSchemasAssignable({ type: 'string' }, {})).toBe(true);
    expect(arePortSchemasAssignable({}, { type: 'string' })).toBe(false);
    expect(arePortSchemasAssignable({ type: 'integer' }, { type: 'number' })).toBe(true);
    expect(arePortSchemasAssignable({ type: 'number' }, { type: 'string' })).toBe(false);
  });
});
