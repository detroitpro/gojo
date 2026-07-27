import { describe, expect, test } from 'bun:test';

import { inspectRunningBinary, isDeletedExeLink } from '@/diagnostics/binary-stale';

describe('diagnostics/binary-stale', () => {
  test('isDeletedExeLink detects Linux replaced-inode marker', () => {
    expect(isDeletedExeLink('/home/x/.local/bin/gojo (deleted)')).toBe(true);
    expect(isDeletedExeLink('/home/x/.local/bin/gojo')).toBe(false);
  });

  test('current process is not stale', () => {
    const status = inspectRunningBinary(process.pid, process.execPath);
    expect(status.stale).toBe(false);
    expect(status.detail).toBeNull();
    expect(status.exePath).toBeTruthy();
  });

  test('falls back when proc exe is unreadable and execPath is missing', () => {
    const status = inspectRunningBinary(999_999_999, '/nonexistent/gojo-binary');
    expect(status.stale).toBe(true);
    expect(status.detail).toContain('missing on disk');
    expect(status.exePath).toBe('/nonexistent/gojo-binary');
  });
});
