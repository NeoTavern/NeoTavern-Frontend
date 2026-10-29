import { expect, test } from 'vitest';
import { mergeWithUndefined, mergeWithUndefinedMulti, StringHash } from '../src/utils/commons';

test('StringHash.legacy() is backward compatible', () => {
  expect(StringHash.legacy(Symbol.for('not a string') as unknown as string)).toBe(0);
  expect(StringHash.legacy('')).toBe(3338908027751811);
  expect(StringHash.legacy('Hello, World')).toBe(1971292682390211);
  expect(StringHash.legacy('🇵🇱')).toBe(8243241217663890);
});

test('StringHash.get() produces consistent 64-bit hash strings', () => {
  expect(StringHash.get(Symbol.for('not a string') as unknown as string)).toBe('00000000000000');
  expect(StringHash.get('')).toBe('0k4n83c07h0j2b');
  expect(StringHash.get('Hello, World')).toBe('0xuwau90ofttqb');
  expect(StringHash.get('🇵🇱')).toBe('0ft91kf0b9b53m');
});

test.each([
  ['replaces arrays', { items: [1, 2, 3], name: 'test' }, { items: [] }, { items: [], name: 'test' }],
  ['keeps explicit undefined values', { a: 1, b: 2 }, { b: undefined }, { a: 1, b: undefined }],
  ['keeps explicit null values', { a: 1, b: 2 }, { b: null }, { a: 1, b: null }],
  [
    'deeply merges plain objects',
    { nested: { a: 1, b: 2 }, value: 'old' },
    { nested: { b: 3, c: 4 }, value: 'new' },
    { nested: { a: 1, b: 3, c: 4 }, value: 'new' },
  ],
  ['replaces nested arrays', { data: { items: [1, 2, 3] } }, { data: { items: [4, 5] } }, { data: { items: [4, 5] } }],
])('mergeWithUndefined %s', (_, target, source, expected) => {
  const result = mergeWithUndefined(target as object, source as object);
  expect(result).toStrictEqual(expected);
});

test('mergeWithUndefined replaces Date objects by reference', () => {
  const date = new Date('2024-12-31');
  expect(mergeWithUndefined({ timestamp: new Date('2024-01-01') }, { timestamp: date }).timestamp).toBe(date);
});

test('mergeWithUndefinedMulti applies sources in order with replacement semantics', () => {
  const result = mergeWithUndefinedMulti(
    { a: 1, value: 'original', items: [1, 2, 3], nested: { x: 10 } },
    { b: 2, value: 'first', items: [4, 5], nested: { y: 20 } },
    { c: 3, value: 'second', items: [], nested: { z: 30 } },
  );
  expect(result).toEqual({ a: 1, b: 2, c: 3, value: 'second', items: [], nested: { x: 10, y: 20, z: 30 } });
});
