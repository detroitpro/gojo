import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  branchExists,
  deleteBranch,
  execGit,
  removeWorktree,
} from '@/infrastructure/git/git';
import type { Repositories } from '@/infrastructure/persistence';
import { RUN_BRANCH_NAMESPACE } from '@/contexts/execution/contract';

export interface WorktreeSweepResult {
  scanned: number;
  removed: string[];
  keptLive: string[];
  errors: Array<{ path: string; error: string }>;
}

export interface WorktreeSweepInput {
  worktreesRoot: string;
  repos: Repositories;
  /** When set, only touch worktrees whose branch/path contains this project slug. */
  projectName?: string;
}

function liveWorkspacePaths(repos: Repositories): Set<string> {
  const live = new Set<string>();
  for (const run of repos.runs.listNonTerminal()) {
    for (const attempt of repos.attempts.listByRun(run.id)) {
      if (attempt.workspacePath) {
        live.add(resolve(attempt.workspacePath));
      }
    }
  }
  return live;
}

async function resolveRepoPath(worktreePath: string): Promise<string | null> {
  const common = await execGit(worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common.exitCode !== 0 || !common.stdout.trim()) {
    return null;
  }
  // git-common-dir points at .git (or the main .git dir for worktrees).
  const gitDir = common.stdout.trim();
  if (gitDir.endsWith('/.git') || gitDir.endsWith('.git')) {
    return gitDir.replace(/\/?\.git$/, '') || null;
  }
  // Worktree gitdir often looks like /repo/.git/worktrees/<name> — climb to repo.
  const marker = '/.git/';
  const idx = gitDir.indexOf(marker);
  if (idx >= 0) {
    return gitDir.slice(0, idx);
  }
  return null;
}

function branchFromWorktreeDir(dirName: string): string {
  return dirName.replace(/__/g, '/');
}

/**
 * Remove worktree directories under `$GOJO_HOME/worktrees` that are not attached
 * to a non-terminal run. Deletes the matching local branch when it is under
 * the reserved run namespace (never touches remotes).
 */
export async function sweepOrphanWorktrees(
  input: WorktreeSweepInput,
): Promise<WorktreeSweepResult> {
  const root = resolve(input.worktreesRoot);
  const result: WorktreeSweepResult = {
    scanned: 0,
    removed: [],
    keptLive: [],
    errors: [],
  };

  if (!existsSync(root)) {
    return result;
  }

  const live = liveWorkspacePaths(input.repos);
  const entries = readdirSync(root);
  for (const name of entries) {
    const worktreePath = join(root, name);
    let isDir = false;
    try {
      isDir = statSync(worktreePath).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const branchName = branchFromWorktreeDir(name);
    if (input.projectName) {
      const needle = `/${input.projectName}/`;
      if (!branchName.includes(needle) && !name.includes(`__${input.projectName}__`)) {
        continue;
      }
    }

    result.scanned += 1;
    const resolved = resolve(worktreePath);
    if (live.has(resolved)) {
      result.keptLive.push(worktreePath);
      continue;
    }

    try {
      const repoPath = existsSync(worktreePath)
        ? await resolveRepoPath(worktreePath)
        : null;

      if (repoPath) {
        try {
          await removeWorktree(repoPath, worktreePath);
        } catch {
          rmSync(worktreePath, { recursive: true, force: true });
        }

        if (
          branchName.startsWith(`${RUN_BRANCH_NAMESPACE}/`) &&
          (await branchExists(repoPath, branchName))
        ) {
          try {
            await deleteBranch(repoPath, branchName);
          } catch {
            // Branch may be checked out elsewhere; worktree removal is enough.
          }
        }
      } else {
        rmSync(worktreePath, { recursive: true, force: true });
      }

      result.removed.push(worktreePath);
    } catch (error) {
      result.errors.push({
        path: worktreePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/** Count orphan worktree dirs (not attached to a live run). */
export function countOrphanWorktrees(
  worktreesRoot: string,
  repos: Repositories,
  projectName?: string,
): { total: number; orphan: number } {
  const root = resolve(worktreesRoot);
  if (!existsSync(root)) {
    return { total: 0, orphan: 0 };
  }
  const live = liveWorkspacePaths(repos);
  let total = 0;
  let orphan = 0;
  for (const name of readdirSync(root)) {
    const worktreePath = join(root, name);
    try {
      if (!statSync(worktreePath).isDirectory()) continue;
    } catch {
      continue;
    }
    const branchName = branchFromWorktreeDir(name);
    if (projectName) {
      const needle = `/${projectName}/`;
      if (!branchName.includes(needle) && !name.includes(`__${projectName}__`)) {
        continue;
      }
    }
    total += 1;
    if (!live.has(resolve(worktreePath))) {
      orphan += 1;
    }
  }
  return { total, orphan };
}
