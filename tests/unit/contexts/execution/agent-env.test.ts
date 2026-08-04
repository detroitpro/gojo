import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildAgentProcessEnv,
  loadAgentEnvironment,
  parseAgentEnvironmentConfig,
  redactSecretValues,
  resolveRepoEnvFilePath,
} from '@/contexts/execution/domain/agent-env';

describe('runs/agent-env', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test('parseAgentEnvironmentConfig returns null for empty or missing config', () => {
    expect(parseAgentEnvironmentConfig('{}')).toBeNull();
    expect(parseAgentEnvironmentConfig('')).toBeNull();
    expect(parseAgentEnvironmentConfig('not-json')).toBeNull();
  });

  test('parseAgentEnvironmentConfig accepts valid config', () => {
    expect(
      parseAgentEnvironmentConfig(
        JSON.stringify({
          file: '.env',
          include: ['KARAKEEP_API_URL', 'KARAKEEP_API_KEY'],
          required: ['KARAKEEP_API_KEY'],
        }),
      ),
    ).toEqual({
      file: '.env',
      include: ['KARAKEEP_API_URL', 'KARAKEEP_API_KEY'],
      required: ['KARAKEEP_API_KEY'],
    });
  });

  test('resolveRepoEnvFilePath rejects path escape and absolute paths', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-env-path-'));
    expect(() => resolveRepoEnvFilePath(tempDir!, '../secret.env')).toThrow(/escapes/);
    expect(() => resolveRepoEnvFilePath(tempDir!, '/etc/passwd')).toThrow(/relative/);
  });

  test('resolveRepoEnvFilePath rejects symlink that escapes the repo', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-env-link-'));
    const outside = mkdtempSync(join(tmpdir(), 'gojo-env-outside-'));
    const outsideFile = join(outside, 'leak.env');
    writeFileSync(outsideFile, 'SECRET=1\n', 'utf8');
    symlinkSync(outsideFile, join(tempDir!, 'linked.env'));

    expect(() => resolveRepoEnvFilePath(tempDir!, 'linked.env')).toThrow(/escapes/);
  });

  test('loadAgentEnvironment selects allowlisted keys from primary checkout', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-env-load-'));
    writeFileSync(
      join(tempDir, '.env'),
      [
        'KARAKEEP_API_URL=http://192.168.5.251:3000',
        'KARAKEEP_API_KEY=super-secret-key',
        'CLOUDFLARE_API_TOKEN=should-not-load',
        '# comment',
        'export GEMINI_API_KEY=also-not',
      ].join('\n'),
      'utf8',
    );

    const loaded = loadAgentEnvironment({
      repoPath: tempDir!,
      environmentJson: JSON.stringify({
        file: '.env',
        include: ['KARAKEEP_API_URL', 'KARAKEEP_API_KEY'],
        required: ['KARAKEEP_API_KEY'],
      }),
    });

    expect(loaded).toEqual({
      values: {
        KARAKEEP_API_URL: 'http://192.168.5.251:3000',
        KARAKEEP_API_KEY: 'super-secret-key',
      },
      secretValues: ['http://192.168.5.251:3000', 'super-secret-key'],
      config: {
        file: '.env',
        include: ['KARAKEEP_API_URL', 'KARAKEEP_API_KEY'],
        required: ['KARAKEEP_API_KEY'],
      },
    });
    expect(loaded?.values['CLOUDFLARE_API_TOKEN']).toBeUndefined();
  });

  test('loadAgentEnvironment fails when required key is missing or empty', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-env-required-'));
    writeFileSync(join(tempDir, '.env'), 'KARAKEEP_API_URL=http://example\n', 'utf8');

    expect(() =>
      loadAgentEnvironment({
        repoPath: tempDir!,
        environmentJson: JSON.stringify({
          file: '.env',
          include: ['KARAKEEP_API_URL', 'KARAKEEP_API_KEY'],
          required: ['KARAKEEP_API_KEY'],
        }),
      }),
    ).toThrow(/KARAKEEP_API_KEY/);

    writeFileSync(
      join(tempDir, '.env'),
      'KARAKEEP_API_URL=http://example\nKARAKEEP_API_KEY=\n',
      'utf8',
    );
    expect(() =>
      loadAgentEnvironment({
        repoPath: tempDir!,
        environmentJson: JSON.stringify({
          file: '.env',
          include: ['KARAKEEP_API_KEY'],
          required: ['KARAKEEP_API_KEY'],
        }),
      }),
    ).toThrow(/KARAKEEP_API_KEY/);
  });

  test('loadAgentEnvironment fails clearly when file is missing', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-env-missing-'));
    expect(() =>
      loadAgentEnvironment({
        repoPath: tempDir!,
        environmentJson: JSON.stringify({
          file: '.env',
          include: ['KARAKEEP_API_KEY'],
          required: ['KARAKEEP_API_KEY'],
        }),
      }),
    ).toThrow(/\.env/);
  });

  test('buildAgentProcessEnv applies precedence and keeps GOJO_* last', () => {
    const env = buildAgentProcessEnv({
      daemonEnv: {
        PATH: '/usr/bin',
        KARAKEEP_API_KEY: 'daemon-key',
        GOJO_HOME: '/home/gojo',
      },
      projectValues: {
        KARAKEEP_API_KEY: 'project-key',
        KARAKEEP_API_URL: 'http://project',
        GOJO_RUN_ID: 'from-file',
      },
      platformEnv: {
        GOJO_RUN_ID: 'run-123',
        GOJO_AGENT_ID: 'agent-1',
        GOJO_PROJECT_ID: 'project-1',
      },
    });

    expect(env['PATH']).toBe('/usr/bin');
    expect(env['KARAKEEP_API_KEY']).toBe('project-key');
    expect(env['KARAKEEP_API_URL']).toBe('http://project');
    expect(env['GOJO_RUN_ID']).toBe('run-123');
    expect(env['GOJO_AGENT_ID']).toBe('agent-1');
    expect(env['GOJO_HOME']).toBe('/home/gojo');
  });

  test('buildAgentProcessEnv excludes forge write credentials inherited from daemon env', () => {
    const env = buildAgentProcessEnv({
      daemonEnv: {
        PATH: '/usr/bin',
        FORGEJO_TOKEN: 'daemon-forgejo',
        GITEA_TOKEN: 'daemon-gitea',
        GOJO_FORGEJO_TOKEN: 'daemon-gojo-forgejo',
        GH_TOKEN: 'daemon-gh',
        GITHUB_TOKEN: 'daemon-github',
        SOURCE_WRITE_TOKEN: 'daemon-source',
        GOJO_RUN_ID: 'daemon-run',
      },
      projectValues: {
        GH_TOKEN: 'project-gh',
      },
      platformEnv: {
        GOJO_RUN_ID: 'platform-run',
      },
      deniedDaemonEnvKeys: ['SOURCE_WRITE_TOKEN', 'GOJO_RUN_ID'],
    });

    expect(env['PATH']).toBe('/usr/bin');
    expect(env['FORGEJO_TOKEN']).toBeUndefined();
    expect(env['GITEA_TOKEN']).toBeUndefined();
    expect(env['GOJO_FORGEJO_TOKEN']).toBeUndefined();
    expect(env['GH_TOKEN']).toBe('project-gh');
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    expect(env['SOURCE_WRITE_TOKEN']).toBeUndefined();
    expect(env['GOJO_RUN_ID']).toBe('platform-run');
  });

  test('redactSecretValues strips loaded values from text', () => {
    expect(
      redactSecretValues('key=super-secret-key url=http://x', [
        'super-secret-key',
        'http://x',
      ]),
    ).toBe('key=*** url=***');
  });

  test('loadAgentEnvironment uses realpath root for nested files', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gojo-env-nested-'));
    mkdirSync(join(tempDir, 'config'), { recursive: true });
    writeFileSync(join(tempDir, 'config', 'agent.env'), 'FOO=bar\n', 'utf8');
    const root = realpathSync(tempDir);

    const loaded = loadAgentEnvironment({
      repoPath: root,
      environmentJson: JSON.stringify({
        file: 'config/agent.env',
        include: ['FOO'],
      }),
    });
    expect(loaded?.values).toEqual({ FOO: 'bar' });
  });
});
