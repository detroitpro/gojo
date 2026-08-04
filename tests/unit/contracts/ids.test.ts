import { describe, expect, test } from 'bun:test';

import { decodeUlidTimestamp, generateUlid, isValidUlid } from '@shared/ids';

describe('shared/ids', () => {
  test('generateUlid, isValidUlid, and decodeUlidTimestamp round-trip', () => {
    const id = generateUlid();

    expect(isValidUlid(id)).toBe(true);
    expect(isValidUlid('not-a-ulid')).toBe(false);
    expect(() => decodeUlidTimestamp('not-a-ulid')).toThrow();

    const timestamp = decodeUlidTimestamp(id);
    expect(timestamp).toBeLessThanOrEqual(Date.now());
    expect(timestamp).toBeGreaterThan(Date.now() - 5_000);
  });
});
