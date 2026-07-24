import { describe, expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import {
  parseProjectManifest,
  ProjectManifestSchema,
  safeParseProjectManifest,
} from '../../../src/shared/manifest';

/** Sample manifest from PRD §8. */
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
    You are executing an unattended scheduled task.
    A future agent may inspect and continue this work.
    Produce a complete structured handoff report.

agents:
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

tasks:
  dependency-maintenance:
    description: Review and safely update outdated dependencies.
    agent: maintenance
    promptFile: .gojo/tasks/dependency-maintenance.md
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
  weekly-dependencies:
    task: dependency-maintenance
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
    expect(manifest.agents['maintenance']?.adapter).toBe('claude-code');
    expect(manifest.agents['reviewer']?.readOnly).toBe(true);
    expect(manifest.validationProfiles['standard']?.steps).toHaveLength(4);
    expect(manifest.tasks['dependency-maintenance']?.integration?.mode).toBe('pull-request');
    expect(manifest.schedules?.['weekly-dependencies']?.cron).toBe('0 3 * * 1');
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
    const tasks = parsed['tasks'] as Record<string, Record<string, unknown>>;
    const result = ProjectManifestSchema.safeParse({
      ...parsed,
      tasks: {
        ...tasks,
        'dependency-maintenance': {
          ...tasks['dependency-maintenance'],
          integration: {
            mode: 'direct-merge',
            targetBranch: 'main',
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
});
