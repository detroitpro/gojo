import { runProcess } from '@/process/supervisor';

export class GitError extends Error {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    message: string,
    exitCode: number,
    stdout: string,
    stderr: string,
  ) {
    super(message);
    this.name = 'GitError';
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export interface GitExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function execGit(cwd: string, args: string[]): Promise<GitExecResult> {
  try {
    const result = await runProcess({
      command: 'git',
      args,
      cwd,
    });

    return {
      stdout: result.stdout.trimEnd(),
      stderr: result.stderr.trimEnd(),
      exitCode: result.exitCode ?? 1,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitError(
      `git ${args.join(' ')} failed to spawn: ${message}`,
      127,
      '',
      message,
    );
  }
}

function throwIfFailed(
  operation: string,
  result: GitExecResult,
  args: string[],
): void {
  if (result.exitCode === 0) {
    return;
  }

  throw new GitError(
    `git ${args.join(' ')} failed (${operation}): ${result.stderr || result.stdout}`,
    result.exitCode,
    result.stdout,
    result.stderr,
  );
}

async function execGitOrThrow(
  cwd: string,
  args: string[],
  operation = args[0] ?? 'unknown',
): Promise<GitExecResult> {
  const result = await execGit(cwd, args);
  throwIfFailed(operation, result, args);
  return result;
}

export { execGit };

export async function isRepo(cwd: string): Promise<boolean> {
  const result = await execGit(cwd, ['rev-parse', '--git-dir']);
  return result.exitCode === 0;
}

export async function getHead(cwd: string): Promise<string> {
  const result = await execGitOrThrow(cwd, ['rev-parse', 'HEAD'], 'getHead');
  return result.stdout;
}

export async function getBranch(cwd: string): Promise<string> {
  const result = await execGitOrThrow(
    cwd,
    ['branch', '--show-current'],
    'getBranch',
  );
  return result.stdout;
}

export async function fetch(
  cwd: string,
  remote = 'origin',
): Promise<void> {
  await execGitOrThrow(cwd, ['fetch', remote], 'fetch');
}

/** Resolve the SHA of `remote/branch` (after fetch). */
export async function resolveRemoteTrackingRef(
  cwd: string,
  branch: string,
  remote = 'origin',
): Promise<string> {
  const remoteRef = `${remote}/${branch}`;
  const result = await execGit(cwd, ['rev-parse', '--verify', remoteRef]);
  if (result.exitCode !== 0) {
    throw new GitError(
      `Unable to resolve ${remoteRef}`,
      result.exitCode,
      result.stdout,
      result.stderr,
    );
  }
  return result.stdout;
}

/**
 * Fetch and best-effort fast-forward a local branch to match remote/branch.
 * Never fails solely because the checked-out working tree is dirty — the remote
 * tracking ref is enough for worktree prep.
 */
export async function fetchAndFastForwardBranch(
  cwd: string,
  branch: string,
  remote = 'origin',
): Promise<void> {
  await fetch(cwd, remote);
  // Update local branch ref from remote tracking branch (ff-only).
  const result = await execGit(cwd, [
    'fetch',
    remote,
    `${branch}:${branch}`,
  ]);
  if (result.exitCode === 0) {
    return;
  }
  // Fallback: merge --ff-only while on the branch (or update-ref when detached).
  const remoteRef = `${remote}/${branch}`;
  await resolveRemoteTrackingRef(cwd, branch, remote);
  const current = await execGit(cwd, ['branch', '--show-current']);
  if (current.exitCode === 0 && current.stdout === branch) {
    // Best-effort: dirty/diverged primary checkouts must not block runs.
    const merge = await execGit(cwd, ['merge', '--ff-only', remoteRef]);
    if (merge.exitCode !== 0) {
      return;
    }
    return;
  }
  // Force local branch tip to remote when not checked out (safe for gojo worktrees).
  await execGitOrThrow(
    cwd,
    ['branch', '-f', branch, remoteRef],
    'fetchAndFastForwardBranch',
  );
}

export async function hasRemote(cwd: string, remote = 'origin'): Promise<boolean> {
  const result = await execGit(cwd, ['remote', 'get-url', remote]);
  return result.exitCode === 0;
}

export async function createBranch(
  cwd: string,
  branchName: string,
  startPoint: string,
): Promise<void> {
  await execGitOrThrow(
    cwd,
    ['branch', branchName, startPoint],
    'createBranch',
  );
}

export async function addWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  await execGitOrThrow(
    repoPath,
    ['worktree', 'add', worktreePath, branchName],
    'addWorktree',
  );
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<void> {
  await execGitOrThrow(
    repoPath,
    ['worktree', 'remove', '--force', worktreePath],
    'removeWorktree',
  );
}

export interface PathspecOptions {
  /** Repo-relative paths to leave out of the operation. */
  exclude?: readonly string[];
}

/**
 * Builds a `-- . :(exclude)<path>` pathspec suffix, or nothing when there is
 * nothing to exclude, so callers can share one exclusion contract across
 * status/diff/add.
 */
function pathspecArgs(options: PathspecOptions = {}): string[] {
  const exclude = options.exclude ?? [];
  if (exclude.length === 0) {
    return [];
  }
  return ['--', '.', ...exclude.map((path) => `:(exclude)${path}`)];
}

export async function statusPorcelain(
  cwd: string,
  options: PathspecOptions = {},
): Promise<string> {
  const result = await execGitOrThrow(
    cwd,
    ['status', '--porcelain', ...pathspecArgs(options)],
    'statusPorcelain',
  );
  return result.stdout;
}

export async function diffNameOnly(
  cwd: string,
  base?: string,
  options: PathspecOptions = {},
): Promise<string[]> {
  const pathspec = pathspecArgs(options);
  const diffArgs = base
    ? ['diff', '--name-only', base, ...pathspec]
    : ['diff', '--name-only', ...pathspec];
  const diffResult = await execGit(cwd, diffArgs);
  throwIfFailed('diffNameOnly', diffResult, diffArgs);

  const untrackedArgs = [
    'ls-files',
    '--others',
    '--exclude-standard',
    ...pathspec,
  ];
  const untrackedResult = await execGit(cwd, untrackedArgs);
  throwIfFailed('diffNameOnly', untrackedResult, untrackedArgs);

  const names = new Set<string>();
  for (const line of diffResult.stdout.split('\n')) {
    if (line.length > 0) {
      names.add(line);
    }
  }
  for (const line of untrackedResult.stdout.split('\n')) {
    if (line.length > 0) {
      names.add(line);
    }
  }

  return [...names];
}

export async function commitAll(
  cwd: string,
  message: string,
  options: PathspecOptions = {},
): Promise<string> {
  await execGitOrThrow(cwd, ['add', '-A', ...pathspecArgs(options)], 'commitAll');
  await execGitOrThrow(
    cwd,
    ['commit', '-m', message],
    'commitAll',
  );
  return getHead(cwd);
}

export async function push(
  cwd: string,
  remote = 'origin',
  refspec?: string,
): Promise<void> {
  const args = refspec ? ['push', remote, refspec] : ['push', remote];
  await execGitOrThrow(cwd, args, 'push');
}

export async function mergeFastForward(
  cwd: string,
  branch: string,
): Promise<void> {
  await execGitOrThrow(
    cwd,
    ['merge', '--ff-only', branch],
    'mergeFastForward',
  );
}

export async function rebase(
  cwd: string,
  onto: string,
): Promise<void> {
  await execGitOrThrow(cwd, ['rebase', onto], 'rebase');
}

export async function branchExists(
  cwd: string,
  branchName: string,
): Promise<boolean> {
  const result = await execGit(cwd, ['show-ref', '--verify', `refs/heads/${branchName}`]);
  return result.exitCode === 0;
}

/** Create an orphan branch only when it does not already exist. */
export async function createOrphanSafe(
  cwd: string,
  branchName: string,
): Promise<void> {
  if (await branchExists(cwd, branchName)) {
    return;
  }

  await execGitOrThrow(
    cwd,
    ['checkout', '--orphan', branchName],
    'createOrphanSafe',
  );
  await execGitOrThrow(cwd, ['reset', '--hard'], 'createOrphanSafe');
}

export async function deleteBranch(
  cwd: string,
  branchName: string,
): Promise<void> {
  await execGitOrThrow(cwd, ['branch', '-D', branchName], 'deleteBranch');
}

export async function initRepo(cwd: string): Promise<void> {
  await execGitOrThrow(cwd, ['init', '-b', 'main'], 'initRepo');
}

export async function configLocal(
  cwd: string,
  key: string,
  value: string,
): Promise<void> {
  await execGitOrThrow(cwd, ['config', key, value], 'configLocal');
}

export async function addRemote(
  cwd: string,
  name: string,
  url: string,
): Promise<void> {
  await execGitOrThrow(cwd, ['remote', 'add', name, url], 'addRemote');
}
