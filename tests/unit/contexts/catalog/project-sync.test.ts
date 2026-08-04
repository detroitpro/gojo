import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { syncProjectFromManifest } from '@/contexts/catalog/application/project-sync';
import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from '@/infrastructure/persistence';

function writeGojoYaml(
  repoPath: string,
  schedulesYaml: string,
  options: {
    projectEnabled?: boolean;
    agentEnabled?: boolean;
    scheduleEnabled?: boolean;
  } = {},
): void {
  const projectEnabledLine =
    options.projectEnabled === undefined ? '' : `\n  enabled: ${options.projectEnabled}`;
  const agentEnabledLine =
    options.agentEnabled === undefined ? '' : `\n    enabled: ${options.agentEnabled}`;
  let schedulesBlock = schedulesYaml;
  if (options.scheduleEnabled !== undefined && schedulesYaml.includes('timezone:')) {
    schedulesBlock = schedulesYaml.replace(
      /timezone: ([^\n]+)/,
      `timezone: $1\n    enabled: ${options.scheduleEnabled}`,
    );
  }
  writeFileSync(
    join(repoPath, 'gojo.yaml'),
    `version: 1
project:
  name: sync-demo
  defaultBranch: main${projectEnabledLine}
repository:
  remote: origin
  syncBeforeRun: true
  requireCleanBase: true
  submodules: false
  gitLfs: false
profiles:
  cursor:
    adapter: cursor
    timeout: 5m
validationProfiles:
  handoff:
    steps:
      - name: ok
        command: "true"
        timeout: 30s
agents:
  demo:
    description: Demo agent
    profile: cursor
    promptFile: .gojo/agents/demo.md
    validationProfile: handoff${agentEnabledLine}
    integration:
      mode: commit-only
      targetBranch: main
${schedulesBlock}
`,
    'utf8',
  );
}

describe('app/project-sync', () => {
  let db: Database | null = null;
  let repoPath: string | null = null;

  afterEach(() => {
    db?.close();
    db = null;
    if (repoPath) {
      rmSync(repoPath, { recursive: true, force: true });
      repoPath = null;
    }
  });

  function openDb(): Database {
    db = Database.open(':memory:');
    db.migrate();
    return db;
  }

  function createRepoWithManifest(schedulesYaml: string): string {
    repoPath = mkdtempSync(join(tmpdir(), 'gojo-sync-'));
    mkdirSync(join(repoPath, '.gojo', 'agents'), { recursive: true });
    writeFileSync(join(repoPath, '.gojo', 'agents', 'demo.md'), 'do the thing\n', 'utf8');
    writeGojoYaml(repoPath, schedulesYaml);
    return repoPath;
  }

  test('soft-disables schedules removed or renamed in the manifest', () => {
    const path = createRepoWithManifest(`schedules:
  demo-daily:
    agent: demo
    cron: "0 6 * * *"
    timezone: UTC
`);
    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: 'sync-demo', repoPath: path });

    expect(syncProjectFromManifest(repos, project).schedules).toBe(1);
    const agentId = repos.agents.listByProject(project.id).find((a) => a.name === 'demo')!.id;
    expect(repos.schedules.listByAgent(agentId)[0]?.name).toBe('demo-daily');
    expect(repos.schedules.listByAgent(agentId)[0]?.enabled).toBe(true);

    writeGojoYaml(
      path,
      `schedules:
  demo:
    agent: demo
    cron: "0 6 * * *"
    timezone: UTC
`,
    );

    expect(syncProjectFromManifest(repos, project).schedules).toBe(1);
    const schedules = repos.schedules.listByAgent(agentId);
    expect(schedules).toHaveLength(2);
    expect(schedules.find((s) => s.name === 'demo-daily')?.enabled).toBe(false);
    expect(schedules.find((s) => s.name === 'demo')?.enabled).toBe(true);
  });

  test('soft-disables all project schedules when manifest omits schedules', () => {
    const path = createRepoWithManifest(`schedules:
  demo:
    agent: demo
    cron: "0 6 * * *"
    timezone: UTC
`);
    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: 'sync-demo', repoPath: path });
    syncProjectFromManifest(repos, project);

    writeGojoYaml(path, '');
    expect(syncProjectFromManifest(repos, project).schedules).toBe(0);

    const agentId = repos.agents.listByProject(project.id).find((a) => a.name === 'demo')!.id;
    expect(repos.schedules.listByAgent(agentId).every((s) => !s.enabled)).toBe(true);
  });

  test('returns empty counts when no manifest exists', () => {
    repoPath = mkdtempSync(join(tmpdir(), 'gojo-sync-empty-'));
    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: 'empty-repo', repoPath });

    expect(syncProjectFromManifest(repos, project)).toEqual({
      manifestPath: null,
      profiles: 0,
      agents: 0,
      schedules: 0,
    });
  });

  test('resolves .gojo/project.yaml when gojo.yaml is absent', () => {
    repoPath = mkdtempSync(join(tmpdir(), 'gojo-sync-alt-'));
    mkdirSync(join(repoPath, '.gojo', 'agents'), { recursive: true });
    writeFileSync(join(repoPath, '.gojo', 'agents', 'demo.md'), 'alternate manifest prompt\n', 'utf8');
    writeFileSync(
      join(repoPath, '.gojo', 'project.yaml'),
      `version: 1
project:
  name: alt-sync
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
    timeout: 5m
validationProfiles:
  handoff:
    steps:
      - name: ok
        command: "true"
        timeout: 30s
agents:
  demo:
    description: Alt agent
    profile: cursor
    promptFile: .gojo/agents/demo.md
    validationProfile: handoff
    integration:
      mode: commit-only
      targetBranch: main
`,
      'utf8',
    );

    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: 'alt-sync', repoPath });
    const result = syncProjectFromManifest(repos, project);

    expect(result.manifestPath).toBe(join(repoPath, '.gojo', 'project.yaml'));
    expect(result.agents).toBe(1);
    expect(repos.agents.listByProject(project.id).find((a) => a.name === 'demo')?.prompt).toBe(
      'alternate manifest prompt\n',
    );
  });

  test('persists agent environment config without secret values', () => {
    repoPath = mkdtempSync(join(tmpdir(), 'gojo-sync-env-'));
    mkdirSync(join(repoPath, '.gojo', 'agents'), { recursive: true });
    writeFileSync(join(repoPath, '.gojo', 'agents', 'demo.md'), 'do the thing\n', 'utf8');
    writeFileSync(
      join(repoPath, 'gojo.yaml'),
      `version: 1
project:
  name: sync-env
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
    timeout: 5m
validationProfiles:
  handoff:
    steps:
      - name: ok
        command: "true"
        timeout: 30s
agents:
  demo:
    description: Demo agent
    profile: cursor
    promptFile: .gojo/agents/demo.md
    validationProfile: handoff
    environment:
      file: .env
      include:
        - KARAKEEP_API_URL
        - KARAKEEP_API_KEY
      required:
        - KARAKEEP_API_KEY
    integration:
      mode: commit-only
      targetBranch: main
`,
      'utf8',
    );

    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: 'sync-env', repoPath });
    syncProjectFromManifest(repos, project);

    const agent = repos.agents.listByProject(project.id).find((a) => a.name === 'demo');
    expect(JSON.parse(agent?.environmentJson ?? '{}')).toEqual({
      file: '.env',
      include: ['KARAKEEP_API_URL', 'KARAKEEP_API_KEY'],
      required: ['KARAKEEP_API_KEY'],
    });
    expect(agent?.environmentJson).not.toContain('secret');
  });

  test('persists declarative work trigger config', () => {
    const path = createRepoWithManifest('');
    const manifestPath = join(path, 'gojo.yaml');
    const manifest = readFileSync(manifestPath, 'utf8').replace(
      '    validationProfile: handoff\n',
      `    validationProfile: handoff
    trigger:
      on: issue-label
      requireLabels: [gojo:ready]
      trustedActors: [detroitpro]
      maxOpenClaims: 1
`,
    );
    writeFileSync(manifestPath, manifest, 'utf8');

    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: 'sync-trigger', repoPath: path });
    syncProjectFromManifest(repos, project);

    const agent = repos.agents.listByProject(project.id).find((a) => a.name === 'demo');
    expect(JSON.parse(agent?.triggerJson ?? '{}')).toEqual({
      on: 'issue-label',
      requireLabels: ['gojo:ready'],
      trustedActors: ['detroitpro'],
      maxOpenClaims: 1,
    });
  });

  test('applies project/agent/schedule enabled from YAML (manifest wins over ops)', () => {
    const path = createRepoWithManifest(`schedules:
  demo:
    agent: demo
    cron: "0 6 * * *"
    timezone: UTC
`);
    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: 'sync-demo', repoPath: path });
    syncProjectFromManifest(repos, project);

    expect(repos.projects.findById(project.id)?.enabled).toBe(true);
    const agent = repos.agents.listByProject(project.id).find((a) => a.name === 'demo')!;
    expect(agent.enabled).toBe(true);
    expect(repos.schedules.listByAgent(agent.id)[0]?.enabled).toBe(true);

    repos.projects.update(project.id, { enabled: false });
    repos.agents.update(agent.id, { enabled: false });
    repos.schedules.update(repos.schedules.listByAgent(agent.id)[0]!.id, { enabled: false });

    writeGojoYaml(path, `schedules:
  demo:
    agent: demo
    cron: "0 6 * * *"
    timezone: UTC
`);
    syncProjectFromManifest(repos, project);

    expect(repos.projects.findById(project.id)?.enabled).toBe(true);
    expect(repos.agents.findById(agent.id)?.enabled).toBe(true);
    expect(repos.schedules.listByAgent(agent.id)[0]?.enabled).toBe(true);

    writeGojoYaml(
      path,
      `schedules:
  demo:
    agent: demo
    cron: "0 6 * * *"
    timezone: UTC
`,
      { projectEnabled: false, agentEnabled: false, scheduleEnabled: false },
    );
    syncProjectFromManifest(repos, project);

    expect(repos.projects.findById(project.id)?.enabled).toBe(false);
    expect(repos.agents.findById(agent.id)?.enabled).toBe(false);
    expect(repos.schedules.listByAgent(agent.id)[0]?.enabled).toBe(false);
  });

  test('does not resurrect disabled schedule names absent from manifest', () => {
    const path = createRepoWithManifest(`schedules:
  demo-daily:
    agent: demo
    cron: "0 6 * * *"
    timezone: UTC
`);
    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: 'sync-demo', repoPath: path });
    syncProjectFromManifest(repos, project);

    writeGojoYaml(
      path,
      `schedules:
  demo:
    agent: demo
    cron: "0 6 * * *"
    timezone: UTC
`,
    );
    syncProjectFromManifest(repos, project);
    syncProjectFromManifest(repos, project);

    const agentId = repos.agents.listByProject(project.id).find((a) => a.name === 'demo')!.id;
    const stale = repos.schedules.listByAgent(agentId).find((s) => s.name === 'demo-daily');
    expect(stale?.enabled).toBe(false);
    // Sanity: file still on disk for debugging flaky path issues
    expect(readFileSync(join(path, 'gojo.yaml'), 'utf8')).toContain('schedules:');
  });
});
