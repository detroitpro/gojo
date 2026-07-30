import { describe, expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import {
  parseProjectManifest,
  ProjectManifestSchema,
  safeParseProjectManifest,
} from '../../../src/shared/manifest';

/** Sample manifest from PRD §8 in the post-Tasks→Agents rebrand vocabulary. */
const prdManifestYaml = `
version: 1

project:
  name: billing-service
  defaultBranch: main

repository:
  remote: origin
  syncBeforeRun: true
  requireCleanBase: true
  submodules: false
  gitLfs: false

instructions:
  files:
    - AGENTS.md
    - docs/architecture.md
  scheduledRunNotice: |
    You are executing an unattended scheduled agent.
    A future agent may inspect and continue this work.
    Produce a complete structured handoff report.

profiles:
  maintenance:
    adapter: claude-code
    model: default
    timeout: 45m
    permissions:
      filesystem: project
      shell: allowlisted
      network: restricted

  reviewer:
    adapter: cursor
    timeout: 30m
    readOnly: true

validationProfiles:
  standard:
    steps:
      - name: install
        command: pnpm install --frozen-lockfile
        timeout: 10m

      - name: lint
        command: pnpm lint
        timeout: 10m

      - name: test
        command: pnpm test
        timeout: 20m

      - name: build
        command: pnpm build
        timeout: 20m

agents:
  dependency-maintenance:
    description: Review and safely update outdated dependencies.
    profile: maintenance
    promptFile: .gojo/agents/dependency-maintenance.md
    validationProfile: standard

    concurrency:
      projectLimit: 1
      overlapPolicy: skip

    integration:
      mode: pull-request
      targetBranch: main
      requireAllValidations: true

    failurePolicy:
      maxAttemptsPerRun: 2
      disableAfterConsecutiveFailedRuns: 3
      backoff: exponential

schedules:
  dependency-maintenance:
    agent: dependency-maintenance
    cron: "0 3 * * 1"
    timezone: America/Detroit

notifications:
  onSuccess:
    - engineering-slack
  onFailure:
    - engineering-slack
    - operations-teams
  onDisabled:
    - operations-teams
`;

describe('ProjectManifest', () => {
  test('parses PRD §8 sample manifest from YAML', () => {
    const parsed = parseYaml(prdManifestYaml) as unknown;
    const manifest = parseProjectManifest(parsed);

    expect(manifest.version).toBe(1);
    expect(manifest.project.name).toBe('billing-service');
    expect(manifest.project.defaultBranch).toBe('main');
    expect(manifest.repository.syncBeforeRun).toBe(true);
    expect(manifest.instructions?.files).toEqual(['AGENTS.md', 'docs/architecture.md']);
    expect(manifest.profiles['maintenance']?.adapter).toBe('claude-code');
    expect(manifest.profiles['reviewer']?.readOnly).toBe(true);
    expect(manifest.validationProfiles['standard']?.steps).toHaveLength(4);
    expect(manifest.agents['dependency-maintenance']?.integration?.mode).toBe('pull-request');
    expect(manifest.agents['dependency-maintenance']?.profile).toBe('maintenance');
    expect(manifest.schedules?.['dependency-maintenance']?.cron).toBe('0 3 * * 1');
    expect(manifest.schedules?.['dependency-maintenance']?.agent).toBe(
      'dependency-maintenance',
    );
    expect(manifest.notifications?.onFailure).toEqual([
      'engineering-slack',
      'operations-teams',
    ]);
  });

  test('safeParse succeeds for PRD sample', () => {
    const parsed = parseYaml(prdManifestYaml) as unknown;
    const result = safeParseProjectManifest(parsed);
    expect(result.success).toBe(true);
  });

  test('rejects unsupported manifest version', () => {
    const parsed = parseYaml(prdManifestYaml) as Record<string, unknown>;
    const result = ProjectManifestSchema.safeParse({ ...parsed, version: 2 });
    expect(result.success).toBe(false);
  });

  test('rejects missing required project fields', () => {
    const parsed = parseYaml(prdManifestYaml) as Record<string, unknown>;
    const result = ProjectManifestSchema.safeParse({
      ...parsed,
      project: { name: 'billing-service' },
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid integration mode', () => {
    const parsed = parseYaml(prdManifestYaml) as Record<string, unknown>;
    const agents = parsed['agents'] as Record<string, Record<string, unknown>>;
    const result = ProjectManifestSchema.safeParse({
      ...parsed,
      agents: {
        ...agents,
        'dependency-maintenance': {
          ...agents['dependency-maintenance'],
          integration: {
            mode: 'direct-merge',
            targetBranch: 'main',
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test('accepts integration.prTool tea with optional login/remote', () => {
    const parsed = parseYaml(prdManifestYaml) as Record<string, unknown>;
    const agents = parsed['agents'] as Record<string, Record<string, unknown>>;
    const manifest = parseProjectManifest({
      ...parsed,
      agents: {
        ...agents,
        'dependency-maintenance': {
          ...agents['dependency-maintenance'],
          integration: {
            mode: 'pull-request',
            targetBranch: 'main',
            prTool: 'tea',
            prLogin: 'home',
            prRemote: 'origin',
            prAutoMerge: true,
            prApiUrl: 'http://192.168.5.251:3001',
            prRepo: 'detroitpro/rhystic-gaming',
            prMergeStyle: 'squash',
          },
        },
      },
    });
    expect(manifest.agents['dependency-maintenance']?.integration?.prTool).toBe('tea');
    expect(manifest.agents['dependency-maintenance']?.integration?.prLogin).toBe('home');
    expect(manifest.agents['dependency-maintenance']?.integration?.prAutoMerge).toBe(true);
    expect(manifest.agents['dependency-maintenance']?.integration?.prRepo).toBe(
      'detroitpro/rhystic-gaming',
    );
  });

  test('rejects invalid integration.prTool', () => {
    const parsed = parseYaml(prdManifestYaml) as Record<string, unknown>;
    const agents = parsed['agents'] as Record<string, Record<string, unknown>>;
    const result = ProjectManifestSchema.safeParse({
      ...parsed,
      agents: {
        ...agents,
        'dependency-maintenance': {
          ...agents['dependency-maintenance'],
          integration: {
            mode: 'pull-request',
            targetBranch: 'main',
            prTool: 'glab',
          },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty validation profile steps', () => {
    const parsed = parseYaml(prdManifestYaml) as Record<string, unknown>;
    const result = ProjectManifestSchema.safeParse({
      ...parsed,
      validationProfiles: { standard: { steps: [] } },
    });
    expect(result.success).toBe(false);
  });

  test('rejects legacy top-level tasks/agents naming', () => {
    const parsed = parseYaml(prdManifestYaml) as Record<string, unknown>;
    const legacy = {
      ...parsed,
      // Legacy: adapters lived under top-level `agents:`.
      agents: {
        maintenance: {
          adapter: 'claude-code',
          timeout: '45m',
        },
      },
      // Legacy: work units lived under `tasks:` with an `agent:` pointer.
      tasks: {
        'dependency-maintenance': {
          description: 'legacy',
          agent: 'maintenance',
          promptFile: '.gojo/tasks/dependency-maintenance.md',
          validationProfile: 'standard',
        },
      },
    };
    delete (legacy as Record<string, unknown>)['profiles'];
    const result = ProjectManifestSchema.safeParse(legacy);
    expect(result.success).toBe(false);
  });
});
