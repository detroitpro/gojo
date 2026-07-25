import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  addWorktree,
  createBranch,
  execGit,
  fetchAndFastForwardBranch,
  hasRemote,
  removeWorktree,
  deleteBranch,
  resolveRemoteTrackingRef,
} from '@/git/git';

export interface PrepareAttemptInput {
  repoPath: string;
  baseBranch: string;
  runId: string;
  taskName: string;
  /** Distinguishes multi-attempt branches under the same run. */
  attemptNumber?: number;
  /** When true, fetch + fast-forward baseBranch from origin before branching. */
  syncBeforeRun?: boolean;
  /**
   * When true (or when syncBeforeRun is true), branch from origin/<baseBranch>
   * so a dirty primary checkout cannot block worktree prep.
   */
  useRemoteBase?: boolean;
}

export interface PrepareAttemptResult {
  worktreePath: string;
  branchName: string;
  startingCommit: string;
}

export interface CleanupOptions {
  keepBranch?: boolean;
}

function sanitizeTaskName(taskName: string): string {
  return taskName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'task';
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shortRunId(runId: string): string {
  return runId.slice(0, 8);
}

interface WorktreeRecord {
  repoPath: string;
  branchName: string;
}

export class WorkspaceManager {
  readonly rootDir: string;
  private readonly worktrees = new Map<string, WorktreeRecord>();

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    mkdirSync(rootDir, { recursive: true });
  }

  buildBranchName(
    taskName: string,
    runId: string,
    date = new Date(),
    attemptNumber = 1,
  ): string {
    const safeTask = sanitizeTaskName(taskName);
    // Flat attempt suffix — nested refs like run-xxx/a2 fail when run-xxx already exists.
    const attemptSuffix = attemptNumber > 1 ? `-a${attemptNumber}` : '';
    return `gojo/${safeTask}/${formatDate(date)}/run-${shortRunId(runId)}${attemptSuffix}`;
  }

  buildWorktreePath(branchName: string): string {
    const safePath = branchName.replace(/\//g, '__');
    return join(this.rootDir, safePath);
  }

  async syncBaseBranch(repoPath: string, baseBranch: string): Promise<void> {
    if (!(await hasRemote(repoPath))) {
      return;
    }
    await fetchAndFastForwardBranch(repoPath, baseBranch);
  }

  async prepareAttempt(input: PrepareAttemptInput): Promise<PrepareAttemptResult> {
    const preferRemote = Boolean(input.syncBeforeRun || input.useRemoteBase);

    if (input.syncBeforeRun) {
      // Best-effort local ff; never blocks on a dirty primary checkout.
      await this.syncBaseBranch(input.repoPath, input.baseBranch);
    }

    let startPoint = input.baseBranch;
    let startingCommit: string | null = null;

    if (preferRemote && (await hasRemote(input.repoPath))) {
      // Branch worktrees from the remote tracking tip so operator dirt is irrelevant.
      startPoint = `origin/${input.baseBranch}`;
      startingCommit = await resolveRemoteTrackingRef(
        input.repoPath,
        input.baseBranch,
      );
    }

    const attemptNumber = input.attemptNumber ?? 1;
    const branchName = this.buildBranchName(
      input.taskName,
      input.runId,
      new Date(),
      attemptNumber,
    );
    const worktreePath = this.buildWorktreePath(branchName);

    if (startingCommit == null) {
      const baseRef = await execGit(input.repoPath, ['rev-parse', startPoint]);
      if (baseRef.exitCode !== 0) {
        throw new Error(`Unable to resolve base branch: ${startPoint}`);
      }
      startingCommit = baseRef.stdout;
    }

    await createBranch(input.repoPath, branchName, startPoint);
    await addWorktree(input.repoPath, worktreePath, branchName);
    this.worktrees.set(worktreePath, {
      repoPath: input.repoPath,
      branchName,
    });

    return {
      worktreePath,
      branchName,
      startingCommit,
    };
  }

  async cleanup(
    worktreePath: string,
    branchName?: string,
    options: CleanupOptions = {},
  ): Promise<void> {
    const record = this.worktrees.get(worktreePath);
    if (!record) {
      throw new Error(`Unknown worktree: ${worktreePath}`);
    }

    await removeWorktree(record.repoPath, worktreePath);
    this.worktrees.delete(worktreePath);

    const branchToDelete = branchName ?? record.branchName;
    if (branchToDelete && !options.keepBranch) {
      await deleteBranch(record.repoPath, branchToDelete);
    }
  }
}
