import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  defaultInstanceConfig,
  loadInstanceConfig,
  saveInstanceConfig,
} from '@/platform/config/instance';

describe('config/instance', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test('loadInstanceConfig defaults and saveInstanceConfig persists overrides', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-instance-config-'));
    const dataDir = join(tempDir, 'data');
    const configPath = join(tempDir, 'nested', 'config.yaml');

    const defaults = loadInstanceConfig(configPath, dataDir);
    expect(defaults).toEqual(defaultInstanceConfig(dataDir));

    saveInstanceConfig(configPath, {
      ...defaults,
      bindPort: 9000,
      paused: true,
      telemetryEnabled: true,
    });

    expect(existsSync(configPath)).toBe(true);

    const loaded = loadInstanceConfig(configPath, dataDir);
    expect(loaded.bindPort).toBe(9000);
    expect(loaded.paused).toBe(true);
    expect(loaded.telemetryEnabled).toBe(true);
    expect(loaded.dataDir).toBe(dataDir);
  });
});
