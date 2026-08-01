import { describe, expect, test } from 'bun:test';

import { parseJson, parseJsonObject } from '@shared/json';

describe('parseJson', () => {
  test('parses valid JSON', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('[1,2]')).toEqual([1, 2]);
  });

  test('returns fallback on invalid JSON', () => {
    expect(parseJson('not json')).toEqual({});
    expect(parseJson('not json', null)).toBeNull();
  });
});

describe('parseJsonObject', () => {
  test('returns plain objects', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  test('rejects arrays and primitives', () => {
    expect(parseJsonObject('[1]')).toEqual({});
    expect(parseJsonObject('"x"')).toEqual({});
    expect(parseJsonObject('null')).toEqual({});
  });

  test('returns empty object on invalid JSON', () => {
    expect(parseJsonObject('{')).toEqual({});
  });
});
