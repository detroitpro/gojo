import {
  commitAll,
  diffNameOnly,
  execGit,
  getHead,
  push,
  statusPorcelain,
} from '@/git/git';
import {
  enableForgejoAutoMerge,
  type ForgejoMergeStyle,
} from '@/integration/forgejo-auto-merge';
import {
  buildPrCreateInvocation,
  extractPrUrl,
  normalizePrTool,
  type PrTool,
} from '@/integration/pr-create';
import { runProcess } from '@/process/supervisor';
import { GENERATED_WORKSPACE_PATHS } from '@shared/workspace-files';

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
  /** Overrides commitMessage for PR create --title when set. */
  prTitle?: string;
  /** Markdown body for PR create (--body / --description). */
  prBody?: string;
  /** PR CLI: `gh` (GitHub) or `tea` (Gitea/Forgejo). Default `gh`. */
  prTool?: PrTool;
  /** Tea `--login` when `prTool` is `tea`. */
  prLogin?: string;
  /** Tea `--remote` when `prTool` is `tea` (default `origin` if omitted). */
  prRemote?: string;
  /** Enable Forgejo merge-when-checks-succeed after tea PR create. */
  prAutoMerge?: boolean;
  prApiUrl?: string;
  prRepo?: string;
  prMergeStyle?: ForgejoMergeStyle;
  mergeQueue?: MergeQueue;
}

export interface IntegrateResult {
  commitSha: string | null;
  prUrl: string | null;
  conflict: boolean;
  /**
   * For `pull-request` mode: true when the PR CLI created a real PR URL.
   * False when create failed and `prUrl` is a `local://pr/...` placeholder.
   * Null for modes that do not open PRs.
   */
  prCreated: boolean | null;
  /** Non-null when prAutoMerge was requested but could not be enabled. */
  prAutoMergeError?: string | null;
}

const defaultMergeQueue = new MergeQueue();

const resultCommitPathspec = { exclude: GENERATED_WORKSPACE_PATHS } as const;

async function isDirty(cwd: string): Promise<boolean> {
  const status = await statusPorcelain(cwd, resultCommitPathspec);
  return status.trim().length > 0;
}

async function commitIfDirty(
  worktreePath: string,
  commitMessage: string,
): Promise<string | null> {
  if (!(await isDirty(worktreePath))) {
    return null;
  }

  return commitAll(worktreePath, commitMessage, resultCommitPathspec);
}

async function hasRemote(cwd: string): Promise<boolean> {
  const result = await execGit(cwd, ['remote']);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

async function tryPrCreate(
  repoPath: string,
  opts: {
    tool: PrTool;
    branchName: string;
    targetBranch: string;
    title: string;
    body: string;
    login?: string;
    remote?: string;
  },
): Promise<string | null> {
  const tool = normalizePrTool(opts.tool);
  const invocation = buildPrCreateInvocation({
    tool,
    head: opts.branchName,
    base: opts.targetBranch,
    title: opts.title,
    body: opts.body,
    ...(opts.login ? { login: opts.login } : {}),
    ...(opts.remote ? { remote: opts.remote } : tool === 'tea' ? { remote: 'origin' } : {}),
  });

  const toolCheck = await runProcess({
    command: 'sh',
    args: ['-c', `command -v ${invocation.command} >/dev/null 2>&1`],
    cwd: repoPath,
    timeoutMs: 5_000,
  });

  if (toolCheck.exitCode !== 0) {
    return null;
  }

  const result = await runProcess({
    command: invocation.command,
    args: invocation.args,
    cwd: repoPath,
    timeoutMs: 60_000,
  });

  if (result.exitCode !== 0) {
    return null;
  }

  const combined = `${result.stdout}\n${result.stderr}`;
  const fromOutput = extractPrUrl(combined);
  if (fromOutput) {
    return fromOutput;
  }

  const trimmed = result.stdout.trim();
  return trimmed.length > 0 && /^https?:\/\//i.test(trimmed) ? trimmed : null;
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
      const changed =
        (await diffNameOnly(opts.worktreePath, undefined, resultCommitPathspec)).length > 0;
      if (changed || (await isDirty(opts.worktreePath))) {
        return { commitSha: null, prUrl: null, conflict: false, prCreated: null };
      }
      return { commitSha: null, prUrl: null, conflict: false, prCreated: null };
    }

    case 'commit-only':
    case 'await-approval': {
      const commitSha = await commitIfDirty(opts.worktreePath, opts.commitMessage);
      return { commitSha, prUrl: null, conflict: false, prCreated: null };
    }

    case 'pull-request': {
      const commitSha = await commitIfDirty(opts.worktreePath, opts.commitMessage);

      // PRD §25.11: no Git diff is a valid success — do not push or open a PR.
      if (!commitSha) {
        return { commitSha: null, prUrl: null, conflict: false, prCreated: null };
      }

      if (await hasRemote(opts.repoPath)) {
        await push(opts.repoPath, 'origin', `${opts.branchName}:${opts.branchName}`);
      }

      const prTitle = opts.prTitle?.trim() || opts.commitMessage;
      const prBody =
        opts.prBody?.trim() ||
        `Automated gojo run \`${opts.runId}\`.\n\nTask commit message: ${opts.commitMessage}`;

      const tool = normalizePrTool(opts.prTool);
      const createdUrl = await tryPrCreate(opts.repoPath, {
        tool,
        branchName: opts.branchName,
        targetBranch: opts.targetBranch,
        title: prTitle,
        body: prBody,
        ...(opts.prLogin ? { login: opts.prLogin } : {}),
        ...(opts.prRemote ? { remote: opts.prRemote } : {}),
      });

      if (createdUrl) {
        let prAutoMergeError: string | null = null;
        if (opts.prAutoMerge && tool === 'tea') {
          prAutoMergeError = await enableForgejoAutoMerge({
            prUrl: createdUrl,
            apiUrl: opts.prApiUrl ?? '',
            repo: opts.prRepo ?? '',
            ...(opts.prMergeStyle ? { mergeStyle: opts.prMergeStyle } : {}),
          });
        } else if (opts.prAutoMerge && tool !== 'tea') {
          prAutoMergeError = 'prAutoMerge is only supported with prTool: tea';
        }

        return {
          commitSha,
          prUrl: createdUrl,
          conflict: false,
          prCreated: true,
          prAutoMergeError,
        };
      }

      return {
        commitSha,
        prUrl: `local://pr/${opts.branchName}`,
        conflict: false,
        prCreated: false,
        prAutoMergeError: null,
      };
    }

    case 'auto-merge': {
      const commitSha = await commitIfDirty(opts.worktreePath, opts.commitMessage);

      const mergeResult = await mergeQueue.withLock(opts.projectId, async () =>
        mergeBranch(opts.repoPath, opts.targetBranch, opts.branchName),
      );

      if (mergeResult.conflict) {
        return { commitSha, prUrl: null, conflict: true, prCreated: null };
      }

      const mergedHead = await getHead(opts.repoPath);
      return { commitSha: mergedHead, prUrl: null, conflict: false, prCreated: null };
    }

    default: {
      const _exhaustive: never = opts.mode;
      throw new Error(`Unknown integration mode: ${String(_exhaustive)}`);
    }
  }
}
