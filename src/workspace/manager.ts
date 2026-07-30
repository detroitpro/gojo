import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  addWorktree,
  branchExists,
  createBranch,
  deleteBranch,
  execGit,
  fetchAndFastForwardBranch,
  hasRemote,
  removeWorktree,
  resolveRemoteTrackingRef,
} from '@/git/git';

export interface PrepareAttemptInput {
  repoPath: string;
  baseBranch: string;
  runId: string;
  /** Project display name — sanitized into the branch/worktree path. */
  projectName: string;
  agentName: string;
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

function sanitizeSegment(value: string, fallback: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || fallback
  );
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface WorktreeRecord {
  repoPath: string;
  branchName: string;
}

export class WorkspaceManager {
  readonly rootDir: string;
  private readonly worktrees = new Map<string, WorktreeRecord>();

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
    mkdirSync(this.rootDir, { recursive: true });
  }

  buildBranchName(
    agentName: string,
    runId: string,
    projectName: string,
    date = new Date(),
    attemptNumber = 1,
  ): string {
    const safeProject = sanitizeSegment(projectName, 'project');
    const safeAgent = sanitizeSegment(agentName, 'agent');
    // Flat attempt suffix — nested refs like run-xxx/a2 fail when run-xxx already exists.
    const attemptSuffix = attemptNumber > 1 ? `-a${attemptNumber}` : '';
    // Agent segment stays immediately under `gojo/` so allowlists like
    // `gojo/maintain-quality` still match; project disambiguates the global worktree root.
    return `gojo/${safeAgent}/${safeProject}/${formatDate(date)}/run-${runId}${attemptSuffix}`;
  }

  buildWorktreePath(branchName: string): string {
    const safePath = branchName.replace(/\//g, '__');
    return join(this.rootDir, safePath);
  }

  /** True when path resolves inside the worktrees root (blocks path escape). */
  isPathInsideRoot(candidate: string): boolean {
    const resolved = resolve(candidate);
    const root = this.rootDir.endsWith('/') ? this.rootDir : `${this.rootDir}/`;
    return resolved === this.rootDir || resolved.startsWith(root);
  }

  async syncBaseBranch(repoPath: string, baseBranch: string): Promise<void> {
    if (!(await hasRemote(repoPath))) {
      return;
    }
    await fetchAndFastForwardBranch(repoPath, baseBranch);
  }

  /**
   * Remove a leftover directory/worktree under rootDir so addWorktree can proceed.
   * Prefer git worktree remove; fall back to rm -rf for orphans.
   */
  async reclaimWorktreePath(repoPath: string, worktreePath: string): Promise<void> {
    if (!existsSync(worktreePath)) {
      return;
    }
    if (!this.isPathInsideRoot(worktreePath)) {
      throw new Error(`Refusing to reclaim path outside worktrees root: ${worktreePath}`);
    }

    try {
      await removeWorktree(repoPath, worktreePath);
    } catch {
      rmSync(worktreePath, { recursive: true, force: true });
    }

    this.worktrees.delete(worktreePath);
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
      input.agentName,
      input.runId,
      input.projectName,
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

    await this.reclaimWorktreePath(input.repoPath, worktreePath);
    if (await branchExists(input.repoPath, branchName)) {
      await deleteBranch(input.repoPath, branchName);
    }

    await createBranch(input.repoPath, branchName, startPoint);

    try {
      await addWorktree(input.repoPath, worktreePath, branchName);
    } catch {
      // One retry after reclaim — covers races / half-registered worktrees.
      await this.reclaimWorktreePath(input.repoPath, worktreePath);
      await addWorktree(input.repoPath, worktreePath, branchName);
    }

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
