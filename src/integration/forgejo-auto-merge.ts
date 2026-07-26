export type ForgejoMergeStyle = 'squash' | 'merge' | 'rebase';

export interface ForgejoAutoMergeRequestInput {
  apiUrl: string;
  repo: string;
  prNumber: number;
  mergeStyle: ForgejoMergeStyle;
  token: string;
}

export interface ForgejoAutoMergeRequest {
  url: string;
  headers: {
    Authorization: string;
    'Content-Type': string;
  };
  body: {
    Do: ForgejoMergeStyle;
    merge_when_checks_succeed: boolean;
    delete_branch_after_merge: boolean;
  };
}

/** Parse Forgejo/Gitea PR number from a pulls URL. */
export function extractPrNumberFromUrl(prUrl: string): number | null {
  const match = prUrl.match(/\/pulls\/(\d+)(?:\/|$|\?|#)/i);
  if (!match?.[1]) {
    return null;
  }
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function resolveForgejoToken(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const gojo = env['GOJO_FORGEJO_TOKEN']?.trim();
  if (gojo) {
    return gojo;
  }
  const forgejo = env['FORGEJO_TOKEN']?.trim();
  return forgejo || null;
}

/** Build the Forgejo “merge when checks succeed” request (same shape as Rhystic pr-create.sh). */
export function buildForgejoAutoMergeRequest(
  input: ForgejoAutoMergeRequestInput,
): ForgejoAutoMergeRequest {
  const base = input.apiUrl.replace(/\/+$/, '');
  const repo = input.repo.replace(/^\/+|\/+$/g, '');
  return {
    url: `${base}/api/v1/repos/${repo}/pulls/${input.prNumber}/merge`,
    headers: {
      Authorization: `token ${input.token}`,
      'Content-Type': 'application/json',
    },
    body: {
      Do: input.mergeStyle,
      merge_when_checks_succeed: true,
      delete_branch_after_merge: true,
    },
  };
}

export interface EnableForgejoAutoMergeInput {
  prUrl: string;
  apiUrl: string;
  repo: string;
  mergeStyle?: ForgejoMergeStyle;
  token?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * Enable Forgejo auto-merge after a PR was created.
 * Returns an error string on failure; null on success.
 */
export async function enableForgejoAutoMerge(
  input: EnableForgejoAutoMergeInput,
): Promise<string | null> {
  const prNumber = extractPrNumberFromUrl(input.prUrl);
  if (prNumber === null) {
    return `Could not parse Forgejo PR number from URL: ${input.prUrl}`;
  }

  const apiUrl = input.apiUrl.trim();
  const repo = input.repo.trim();
  if (!apiUrl || !repo) {
    return 'prAutoMerge requires prApiUrl and prRepo';
  }

  // Explicit null/empty means "no token" (tests); omit `token` to read from env.
  const token =
    input.token === undefined ? resolveForgejoToken() : input.token?.trim() || null;
  if (!token) {
    return 'FORGEJO_TOKEN / GOJO_FORGEJO_TOKEN not set — PR created without auto-merge';
  }

  const request = buildForgejoAutoMergeRequest({
    apiUrl,
    repo,
    prNumber,
    mergeStyle: input.mergeStyle ?? 'squash',
    token,
  });

  const fetchFn = input.fetchImpl ?? fetch;
  try {
    const response = await fetchFn(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    if (response.ok) {
      return null;
    }
    let detail = '';
    try {
      const json = (await response.json()) as { message?: unknown };
      if (typeof json.message === 'string' && json.message.trim()) {
        detail = `: ${json.message.trim()}`;
      }
    } catch {
      // ignore body parse errors
    }
    return `Forgejo auto-merge request failed (HTTP ${response.status})${detail}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Forgejo auto-merge request error: ${message}`;
  }
}
