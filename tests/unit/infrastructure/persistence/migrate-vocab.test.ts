import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  migrateProjectVocab,
  rewriteManifestObject,
} from '@/contexts/catalog/infrastructure/migrate-vocab';

const LEGACY_YAML = `version: 1
project:
  name: sample
  defaultBranch: main
repository:
  remote: origin
  syncBeforeRun: true
  requireCleanBase: true
  submodules: false
  gitLfs: false
agents:
  cursor:
    adapter: cursor
    timeout: 5m
validationProfiles:
  handoff:
    steps:
      - name: ok
        command: "true"
        timeout: 30s
tasks:
  self-heal:
    description: Fix things
    agent: cursor
    promptFile: .gojo/tasks/self-heal.md
    validationProfile: handoff
    selfHeal:
      task: self-heal
      afterConsecutiveFailedRuns: 1
  maintain:
    description: Refactor
    agent: cursor
    promptFile: ./.gojo/tasks/maintain.md
    validationProfile: handoff
schedules:
  self-heal:
    task: self-heal
    cron: "0 6 * * *"
    timezone: UTC
`;

describe('rewriteManifestObject', () => {
  test('renames agents→profiles, tasks→agents, and per-agent pointers', () => {
    const raw: Record<string, unknown> = {
      version: 1,
      agents: { cursor: { adapter: 'cursor', timeout: '5m' } },
      validationProfiles: { handoff: { steps: [{ name: 'ok', command: 'true' }] } },
      tasks: {
        'self-heal': {
          description: 'x',
          agent: 'cursor',
          promptFile: '.gojo/tasks/self-heal.md',
          selfHeal: { task: 'self-heal' },
        },
      },
      schedules: {
        'self-heal': { task: 'self-heal', cron: '0 6 * * *', timezone: 'UTC' },
      },
    };
    const { changed, promptFilesUpdated } = rewriteManifestObject(raw);
    expect(changed).toBe(true);
    expect(promptFilesUpdated).toBe(1);
    expect(raw).toEqual({
      version: 1,
      profiles: { cursor: { adapter: 'cursor', timeout: '5m' } },
      validationProfiles: { handoff: { steps: [{ name: 'ok', command: 'true' }] } },
      agents: {
        'self-heal': {
          description: 'x',
          profile: 'cursor',
          promptFile: '.gojo/agents/self-heal.md',
          selfHeal: { agent: 'self-heal' },
        },
      },
      schedules: {
        'self-heal': { agent: 'self-heal', cron: '0 6 * * *', timezone: 'UTC' },
      },
    });
  });

  test('is idempotent on already-migrated input', () => {
    const raw: Record<string, unknown> = {
      version: 1,
      profiles: { cursor: { adapter: 'cursor' } },
      agents: {
        demo: {
          description: 'x',
          profile: 'cursor',
          promptFile: '.gojo/agents/demo.md',
        },
      },
    };
    const before = JSON.stringify(raw);
    const { changed } = rewriteManifestObject(raw);
    expect(changed).toBe(false);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe('migrateProjectVocab', () => {
  let repoPath: string | null = null;

  afterEach(() => {
    if (repoPath) {
      rmSync(repoPath, { recursive: true, force: true });
      repoPath = null;
    }
  });

  function seedLegacyRepo(): string {
    repoPath = mkdtempSync(join(tmpdir(), 'gojo-migrate-'));
    mkdirSync(join(repoPath, '.gojo', 'tasks'), { recursive: true });
    writeFileSync(join(repoPath, '.gojo', 'tasks', 'self-heal.md'), 'heal\n', 'utf8');
    writeFileSync(join(repoPath, '.gojo', 'tasks', 'maintain.md'), 'maintain\n', 'utf8');
    writeFileSync(join(repoPath, 'gojo.yaml'), LEGACY_YAML, 'utf8');
    return repoPath;
  }

  test('rewrites gojo.yaml keys, promptFile paths, and moves .gojo/tasks', () => {
    const path = seedLegacyRepo();
    const result = migrateProjectVocab(path);

    expect(result.manifestPath).toBe(join(path, 'gojo.yaml'));
    expect(result.manifestChanged).toBe(true);
    expect(result.tasksDirMoved).toBe(true);
    expect(result.promptFilesUpdated).toBe(2);

    const migrated = readFileSync(join(path, 'gojo.yaml'), 'utf8');
    expect(migrated).toContain('profiles:');
    expect(migrated).toContain('agents:');
    // Legacy top-level keys are gone.
    expect(migrated).not.toMatch(/^tasks:/m);
    // Per-agent pointers renamed.
    expect(migrated).toContain('profile: cursor');
    expect(migrated).toMatch(/promptFile: \.gojo\/agents\/self-heal\.md/);
    // Schedule pointer renamed (any key order).
    expect(migrated).toMatch(/schedules:[\s\S]*self-heal:[\s\S]*agent: self-heal/);
    expect(migrated).not.toMatch(/task: self-heal/);
    // selfHeal pointer renamed.
    expect(migrated).toMatch(/selfHeal:[\s\S]*agent: self-heal/);

    expect(existsSync(join(path, '.gojo', 'agents', 'self-heal.md'))).toBe(true);
    expect(existsSync(join(path, '.gojo', 'agents', 'maintain.md'))).toBe(true);
    expect(existsSync(join(path, '.gojo', 'tasks'))).toBe(false);
  });

  test('is idempotent — second run reports no changes', () => {
    const path = seedLegacyRepo();
    migrateProjectVocab(path);
    const second = migrateProjectVocab(path);
    expect(second.manifestChanged).toBe(false);
    expect(second.tasksDirMoved).toBe(false);
    expect(second.promptFilesUpdated).toBe(0);
  });

  test('no manifest, no changes', () => {
    repoPath = mkdtempSync(join(tmpdir(), 'gojo-migrate-empty-'));
    const result = migrateProjectVocab(repoPath);
    expect(result.manifestPath).toBeNull();
    expect(result.manifestChanged).toBe(false);
    expect(result.tasksDirMoved).toBe(false);
  });

  test('moves .gojo/tasks folder even when manifest is already migrated', () => {
    repoPath = mkdtempSync(join(tmpdir(), 'gojo-migrate-partial-'));
    mkdirSync(join(repoPath, '.gojo', 'tasks'), { recursive: true });
    writeFileSync(join(repoPath, '.gojo', 'tasks', 'demo.md'), 'demo\n', 'utf8');
    writeFileSync(
      join(repoPath, 'gojo.yaml'),
      `version: 1
project:
  name: partial
  defaultBranch: main
repository:
  remote: origin
  syncBeforeRun: true
  requireCleanBase: true
  submodules: false
  gitLfs: false
profiles:
  cursor:
    adapter: cursor
validationProfiles:
  handoff:
    steps:
      - name: ok
        command: "true"
agents:
  demo:
    description: demo
    profile: cursor
    promptFile: .gojo/agents/demo.md
    validationProfile: handoff
`,
      'utf8',
    );

    const result = migrateProjectVocab(repoPath);
    expect(result.manifestChanged).toBe(false);
    expect(result.tasksDirMoved).toBe(true);
    expect(existsSync(join(repoPath, '.gojo', 'agents', 'demo.md'))).toBe(true);
  });
});
