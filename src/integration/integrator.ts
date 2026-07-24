import {
  commitAll,
  diffNameOnly,
  execGit,
  getHead,
  push,
  statusPorcelain,
} from '@/git/git';
import { runProcess } from '@/process/supervisor';

import { MergeQueue } from './queue';

export type IntegrationMode =
  | 'none'
  | 'commit-only'
  | 'pull-request'
  | 'auto-merge'
  | 'await-approval';

export interface IntegrateOptions {
  mode: IntegrationMode;
  projectId: string;
  worktreePath: string;
  repoPath: string;
  targetBranch: string;
  branchName: string;
  commitMessage: string;
  runId: string;
  /** Overrides commitMessage for `gh pr create --title` when set. */
  prTitle?: string;
  /** Markdown body for `gh pr create --body`. */
  prBody?: string;
  mergeQueue?: MergeQueue;
}

export interface IntegrateResult {
  commitSha: string | null;
  prUrl: string | null;
  conflict: boolean;
}

const defaultMergeQueue = new MergeQueue();

async function isDirty(cwd: string): Promise<boolean> {
  const status = await statusPorcelain(cwd);
  return status.trim().length > 0;
}

async function commitIfDirty(
  worktreePath: string,
  commitMessage: string,
): Promise<string | null> {
  if (!(await isDirty(worktreePath))) {
    return null;
  }

  return commitAll(worktreePath, commitMessage);
}

async function hasRemote(cwd: string): Promise<boolean> {
  const result = await execGit(cwd, ['remote']);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

async function tryGhPrCreate(
  repoPath: string,
  branchName: string,
  targetBranch: string,
  title: string,
  body: string,
): Promise<string | null> {
  const ghCheck = await runProcess({
    command: 'sh',
    args: ['-c', 'command -v gh >/dev/null 2>&1'],
    cwd: repoPath,
    timeoutMs: 5_000,
  });

  if (ghCheck.exitCode !== 0) {
    return null;
  }

  const result = await runProcess({
    command: 'gh',
    args: [
      'pr',
      'create',
      '--head',
      branchName,
      '--base',
      targetBranch,
      '--title',
      title,
      '--body',
      body,
    ],
    cwd: repoPath,
    timeoutMs: 60_000,
  });

  if (result.exitCode !== 0) {
    return null;
  }

  const url = result.stdout.trim();
  return url.length > 0 ? url : null;
}

async function mergeBranch(
  repoPath: string,
  targetBranch: string,
  branchName: string,
): Promise<{ conflict: boolean }> {
  const checkout = await execGit(repoPath, ['checkout', targetBranch]);
  if (checkout.exitCode !== 0) {
    return { conflict: true };
  }

  const merge = await execGit(repoPath, ['merge', '--no-edit', branchName]);
  if (merge.exitCode !== 0) {
    await execGit(repoPath, ['merge', '--abort']);
    return { conflict: true };
  }

  return { conflict: false };
}

export async function integrate(opts: IntegrateOptions): Promise<IntegrateResult> {
  const mergeQueue = opts.mergeQueue ?? defaultMergeQueue;

  switch (opts.mode) {
    case 'none': {
      const changed = (await diffNameOnly(opts.worktreePath)).length > 0;
      if (changed || (await isDirty(opts.worktreePath))) {
        return { commitSha: null, prUrl: null, conflict: false };
      }
      return { commitSha: null, prUrl: null, conflict: false };
    }

    case 'commit-only':
    case 'await-approval': {
      const commitSha = await commitIfDirty(opts.worktreePath, opts.commitMessage);
      return { commitSha, prUrl: null, conflict: false };
    }

    case 'pull-request': {
      const commitSha = await commitIfDirty(opts.worktreePath, opts.commitMessage);

      if (await hasRemote(opts.repoPath)) {
        await push(opts.repoPath, 'origin', `${opts.branchName}:${opts.branchName}`);
      }

      const prTitle = opts.prTitle?.trim() || opts.commitMessage;
      const prBody =
        opts.prBody?.trim() ||
        `Automated gojo run \`${opts.runId}\`.\n\nTask commit message: ${opts.commitMessage}`;

      const ghUrl = await tryGhPrCreate(
        opts.repoPath,
        opts.branchName,
        opts.targetBranch,
        prTitle,
        prBody,
      );

      const prUrl = ghUrl ?? `local://pr/${opts.branchName}`;
      return { commitSha, prUrl, conflict: false };
    }

    case 'auto-merge': {
      const commitSha = await commitIfDirty(opts.worktreePath, opts.commitMessage);

      const mergeResult = await mergeQueue.withLock(opts.projectId, async () =>
        mergeBranch(opts.repoPath, opts.targetBranch, opts.branchName),
      );

      if (mergeResult.conflict) {
        return { commitSha, prUrl: null, conflict: true };
      }

      const mergedHead = await getHead(opts.repoPath);
      return { commitSha: mergedHead, prUrl: null, conflict: false };
    }

    default: {
      const _exhaustive: never = opts.mode;
      throw new Error(`Unknown integration mode: ${String(_exhaustive)}`);
    }
  }
}
