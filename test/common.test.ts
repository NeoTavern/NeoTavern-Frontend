import { expect, test } from 'vitest';
import { StringHash } from '../src/utils/common';

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
