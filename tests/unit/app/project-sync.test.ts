import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { syncProjectFromManifest } from '@/app/project-sync';
import { Database, createRepositories } from '@/storage';

function writeGojoYaml(repoPath: string, schedulesYaml: string): void {
  writeFileSync(
    join(repoPath, 'gojo.yaml'),
    `version: 1
project:
  name: sync-demo
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
  demo:
    description: Demo task
    agent: cursor
    promptFile: .gojo/tasks/demo.md
    validationProfile: handoff
    integration:
      mode: commit-only
      targetBranch: main
${schedulesYaml}
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
    mkdirSync(join(repoPath, '.gojo', 'tasks'), { recursive: true });
    writeFileSync(join(repoPath, '.gojo', 'tasks', 'demo.md'), 'do the thing\n', 'utf8');
    writeGojoYaml(repoPath, schedulesYaml);
    return repoPath;
  }

  test('soft-disables schedules removed or renamed in the manifest', () => {
    const path = createRepoWithManifest(`schedules:
  demo-daily:
    task: demo
    cron: "0 6 * * *"
    timezone: UTC
`);
    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: 'sync-demo', repoPath: path });

    expect(syncProjectFromManifest(repos, project).schedules).toBe(1);
    const taskId = repos.tasks.listByProject(project.id).find((t) => t.name === 'demo')!.id;
    expect(repos.schedules.listByTask(taskId)[0]?.name).toBe('demo-daily');
    expect(repos.schedules.listByTask(taskId)[0]?.enabled).toBe(true);

    writeGojoYaml(
      path,
      `schedules:
  demo:
    task: demo
    cron: "0 6 * * *"
    timezone: UTC
`,
    );

    expect(syncProjectFromManifest(repos, project).schedules).toBe(1);
    const schedules = repos.schedules.listByTask(taskId);
    expect(schedules).toHaveLength(2);
    expect(schedules.find((s) => s.name === 'demo-daily')?.enabled).toBe(false);
    expect(schedules.find((s) => s.name === 'demo')?.enabled).toBe(true);
  });

  test('soft-disables all project schedules when manifest omits schedules', () => {
    const path = createRepoWithManifest(`schedules:
  demo:
    task: demo
    cron: "0 6 * * *"
    timezone: UTC
`);
    const repos = createRepositories(openDb());
    const project = repos.projects.create({ name: 'sync-demo', repoPath: path });
    syncProjectFromManifest(repos, project);

    writeGojoYaml(path, '');
    expect(syncProjectFromManifest(repos, project).schedules).toBe(0);

    const taskId = repos.tasks.listByProject(project.id).find((t) => t.name === 'demo')!.id;
    expect(repos.schedules.listByTask(taskId).every((s) => !s.enabled)).toBe(true);
  });

  test('does not resurrect disabled schedule names absent from manifest', () => {
    const path = createRepoWithManifest(`schedules:
  demo-daily:
    task: demo
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
    task: demo
    cron: "0 6 * * *"
    timezone: UTC
`,
    );
    syncProjectFromManifest(repos, project);
    syncProjectFromManifest(repos, project);

    const taskId = repos.tasks.listByProject(project.id).find((t) => t.name === 'demo')!.id;
    const stale = repos.schedules.listByTask(taskId).find((s) => s.name === 'demo-daily');
    expect(stale?.enabled).toBe(false);
    // Sanity: file still on disk for debugging flaky path issues
    expect(readFileSync(join(path, 'gojo.yaml'), 'utf8')).toContain('schedules:');
  });
});
