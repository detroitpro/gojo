import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';

import { inspectRunningBinary, isDeletedExeLink } from '@/contexts/operations/infrastructure/diagnostics/binary-stale';

describe('diagnostics/binary-stale', () => {
  const spies: Array<ReturnType<typeof spyOn>> = [];

  afterEach(() => {
    for (const spy of spies.splice(0)) {
      spy.mockRestore();
    }
  });

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

  test('flags stale when Linux proc exe link shows deleted inode', () => {
    spies.push(spyOn(os, 'platform').mockReturnValue('linux'));
    spies.push(
      spyOn(fs, 'readlinkSync').mockReturnValue('/usr/local/bin/gojo (deleted)'),
    );

    const status = inspectRunningBinary(42, '/usr/local/bin/gojo');

    expect(status.stale).toBe(true);
    expect(status.detail).toContain('deleted');
    expect(status.exePath).toBe('/usr/local/bin/gojo (deleted)');
  });

  test('flags stale when execPath exists but cannot be stat-ed', () => {
    spies.push(spyOn(os, 'platform').mockReturnValue('darwin'));
    spies.push(spyOn(fs, 'existsSync').mockReturnValue(true));
    spies.push(spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('permission denied');
    }));

    const status = inspectRunningBinary(42, '/usr/local/bin/gojo');

    expect(status.stale).toBe(true);
    expect(status.detail).toContain('Could not stat process.execPath');
    expect(status.exePath).toBe('/usr/local/bin/gojo');
  });
});
