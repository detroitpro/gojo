import type { SourceCapabilities, WorkDelivery, WorkProvenance } from "@shared/work";

import type {
  NormalizedSourceItem,
  SourceAdapter,
  SourceGetItemInput,
  SourceGetItemResult,
  SourceListInput,
  SourceListResult,
} from "./types";
import type {
  NormalizedSourceCheck,
  NormalizedSourceComment,
  NormalizedSourceLabelActor,
  SourceCheckStatus,
  SourceChecksResult,
  SourceCommentInput,
  SourceItemOperationInput,
  SourceMergePullRequestInput,
  SourceMergePullRequestResult,
  SourceSetLabelsInput,
} from "./write-types";

const REPOSITORY_CAPABILITIES: SourceCapabilities = {
  read: true,
  list: true,
  webhooks: true,
  write: true,
  reviews: true,
  checks: true,
  labels: true,
  workKinds: ["pull-request", "issue"],
};

const MAX_PAGES = 100;
const PAGE_SIZE = 100;

function authorProvenance(
  author: { bot?: boolean; type?: string } | null | undefined,
): WorkProvenance {
  return author?.bot || author?.type?.toLowerCase() === "bot" ? "bot" : "human";
}

/** Gojo-owned branches are agent work even when opened via a human gh/tea login. */
function isGojoOwnedBranch(headRef: string | null | undefined): boolean {
  return Boolean(headRef?.startsWith("gojo/"));
}

function provenance(input: {
  kind: "pull-request" | "issue";
  author: { bot?: boolean; type?: string } | null | undefined;
  headRef?: string | null;
}): WorkProvenance {
  if (input.kind === "pull-request" && isGojoOwnedBranch(input.headRef)) {
    return "gojo-agent";
  }
  return authorProvenance(input.author);
}

async function getJsonResponse(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchImpl(url, { headers });
}

async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await getJsonResponse(url, headers, fetchImpl);
  if (!response.ok) {
    throw new Error(`Source sync failed (HTTP ${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
}

async function requestJson<T>(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  init: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      ...headers,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === "string" && body.message.trim()) {
        detail = `: ${body.message.trim()}`;
      }
    } catch {
      // The HTTP status remains actionable when a provider returns a non-JSON body.
    }
    throw new Error(`Source request failed (HTTP ${response.status}) for ${url}${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function requestText(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`Source request failed (HTTP ${response.status}) for ${url}`);
  }
  return response.text();
}

function overallCheckStatus(checks: readonly NormalizedSourceCheck[]): SourceCheckStatus {
  if (checks.some((check) => check.status === "failure")) return "failure";
  if (checks.length === 0 || checks.some((check) => check.status === "pending")) return "pending";
  return "success";
}

function updatedLabels(
  current: readonly string[],
  add: readonly string[] = [],
  remove: readonly string[] = [],
): string[] {
  const removed = new Set(remove);
  return [...new Set([...current.filter((label) => !removed.has(label)), ...add])];
}

async function getAllPages<T>(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await getJson<T[]>(
      `${url}${url.includes("?") ? "&" : "?"}page=${page}`,
      headers,
      fetchImpl,
    );
    items.push(...batch);
    if (batch.length < PAGE_SIZE) {
      return { items, complete: true };
    }
  }
  return { items, complete: false };
}

function deliveryFromState(
  kind: "pull-request" | "issue",
  state: string,
  options: { draft?: boolean; merged?: boolean } = {},
): WorkDelivery {
  const normalized = state.toLowerCase();
  if (kind === "pull-request" && (options.merged || normalized === "merged")) {
    return "merged";
  }
  if (normalized === "closed") return "closed";
  if (kind === "pull-request" && options.draft) return "draft";
  if (normalized === "open" || normalized === "opened" || normalized === "reopened") {
    return "open";
  }
  return "open";
}

function parseGitLabNativeKey(
  kind: string,
  nativeKey: string,
): { kind: "pull-request" | "issue"; iid: string } | null {
  const prefixed = nativeKey.match(/^(pull-request|issue):(\d+)$/);
  if (prefixed) {
    return {
      kind: prefixed[1] as "pull-request" | "issue",
      iid: prefixed[2] ?? "",
    };
  }
  if ((kind === "pull-request" || kind === "issue") && /^\d+$/.test(nativeKey)) {
    return { kind, iid: nativeKey };
  }
  return null;
}

interface GitLabItem {
  iid: number;
  title: string;
  description?: string | null;
  state: string;
  draft?: boolean;
  web_url?: string;
  updated_at?: string;
  author?: { name?: string; username?: string; bot?: boolean };
  labels?: string[];
  merge_status?: string;
  merged_at?: string | null;
  source_branch?: string;
}

interface GitLabNote {
  id: number;
  body?: string;
  author?: { name?: string; username?: string };
  created_at?: string;
  updated_at?: string;
  web_url?: string;
}

interface GitLabLabelEvent {
  id: number;
  action?: string;
  label?: { name?: string };
  user?: { name?: string; username?: string };
  created_at?: string;
}

function gitLabOperation(input: SourceItemOperationInput): {
  fetchImpl: typeof fetch;
  headers: Record<string, string>;
  itemUrl: string;
  api: string;
  project: string;
  parsed: { kind: "pull-request" | "issue"; iid: string };
} {
  const parsed = parseGitLabNativeKey(input.kind, input.nativeKey);
  if (!parsed) throw new Error(`Unsupported GitLab native key: ${input.nativeKey}`);
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, "");
  const api = base.endsWith("/api/v4") ? base : `${base}/api/v4`;
  const project = encodeURIComponent(input.externalKey);
  const resource = parsed.kind === "pull-request" ? "merge_requests" : "issues";
  return {
    fetchImpl,
    headers: {
      Accept: "application/json",
      ...(input.token ? { "PRIVATE-TOKEN": input.token } : {}),
    },
    itemUrl: `${api}/projects/${project}/${resource}/${parsed.iid}`,
    api,
    project,
    parsed,
  };
}

function mapGitLabNote(note: GitLabNote): NormalizedSourceComment {
  return {
    id: String(note.id),
    body: note.body ?? "",
    actor: note.author?.username ?? note.author?.name ?? null,
    createdAt: note.created_at ?? "",
    updatedAt: note.updated_at ?? null,
    webUrl: note.web_url ?? null,
  };
}

function mapGitLabItem(
  item: GitLabItem,
  kind: "pull-request" | "issue",
  observedFallback: string,
): NormalizedSourceItem {
  return {
    kind,
    nativeKey: `${kind}:${item.iid}`,
    title: item.title,
    summary: item.description ?? "",
    delivery: deliveryFromState(kind, item.state, {
      ...(item.draft === undefined ? {} : { draft: item.draft }),
      merged: Boolean(item.merged_at) || item.state === "merged",
    }),
    outcome: "pending",
    provenance: provenance({
      kind,
      author: item.author,
      headRef: item.source_branch ?? null,
    }),
    actorName: item.author?.name ?? item.author?.username ?? null,
    labels: item.labels ?? [],
    nativeState: item.state,
    nativeJson: JSON.stringify(item),
    webUrl: item.web_url ?? null,
    observedAt: item.updated_at ?? observedFallback,
    mergeability: item.merge_status ?? null,
  };
}

export class GitLabSourceAdapter implements SourceAdapter {
  readonly type = "gitlab";
  readonly capabilities = REPOSITORY_CAPABILITIES;

  async listActive(input: SourceListInput): Promise<SourceListResult> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const base = input.baseUrl.replace(/\/+$/, "");
    const api = base.endsWith("/api/v4") ? base : `${base}/api/v4`;
    const project = encodeURIComponent(input.externalKey);
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(input.token ? { "PRIVATE-TOKEN": input.token } : {}),
    };
    const [mergeRequests, issues] = await Promise.all([
      getAllPages<GitLabItem>(
        `${api}/projects/${project}/merge_requests?state=opened&per_page=100&order_by=updated_at`,
        headers,
        fetchImpl,
      ),
      getAllPages<GitLabItem>(
        `${api}/projects/${project}/issues?state=opened&per_page=100&order_by=updated_at`,
        headers,
        fetchImpl,
      ),
    ]);
    const observedFallback = new Date().toISOString();
    return {
      items: [
        ...mergeRequests.items.map((item) => mapGitLabItem(item, "pull-request", observedFallback)),
        ...issues.items.map((item) => mapGitLabItem(item, "issue", observedFallback)),
      ],
      cursor: null,
      backfillComplete: mergeRequests.complete && issues.complete,
    };
  }

  async getItem(input: SourceGetItemInput): Promise<SourceGetItemResult> {
    const parsed = parseGitLabNativeKey(input.kind, input.nativeKey);
    if (!parsed) {
      return { status: "unresolved", detail: `Unsupported GitLab native key: ${input.nativeKey}` };
    }
    const fetchImpl = input.fetchImpl ?? fetch;
    const base = input.baseUrl.replace(/\/+$/, "");
    const api = base.endsWith("/api/v4") ? base : `${base}/api/v4`;
    const project = encodeURIComponent(input.externalKey);
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(input.token ? { "PRIVATE-TOKEN": input.token } : {}),
    };
    const path =
      parsed.kind === "pull-request"
        ? `merge_requests/${parsed.iid}`
        : `issues/${parsed.iid}`;
    const response = await getJsonResponse(
      `${api}/projects/${project}/${path}`,
      headers,
      fetchImpl,
    );
    if (response.status === 404) {
      return { status: "unresolved", detail: `GitLab ${parsed.kind} ${parsed.iid} was not found` };
    }
    if (!response.ok) {
      return {
        status: "unresolved",
        detail: `GitLab item lookup failed (HTTP ${response.status})`,
      };
    }
    const item = (await response.json()) as GitLabItem;
    return {
      status: "found",
      item: mapGitLabItem(item, parsed.kind, new Date().toISOString()),
    };
  }

  async listComments(input: SourceItemOperationInput): Promise<NormalizedSourceComment[]> {
    const { fetchImpl, headers, itemUrl } = gitLabOperation(input);
    const result = await getAllPages<GitLabNote>(
      `${itemUrl}/notes?per_page=100`,
      headers,
      fetchImpl,
    );
    return result.items.map(mapGitLabNote);
  }

  async listLabelActors(
    input: SourceItemOperationInput,
  ): Promise<NormalizedSourceLabelActor[]> {
    const { fetchImpl, headers, itemUrl } = gitLabOperation(input);
    const result = await getAllPages<GitLabLabelEvent>(
      `${itemUrl}/resource_label_events?per_page=100`,
      headers,
      fetchImpl,
    );
    return result.items.flatMap((event) => {
      const label = event.label?.name;
      if (!label || (event.action !== "add" && event.action !== "remove")) return [];
      return [{
        id: String(event.id),
        actor: event.user?.username ?? event.user?.name ?? null,
        action: event.action === "add" ? "added" as const : "removed" as const,
        label,
        occurredAt: event.created_at ?? "",
      }];
    });
  }

  async comment(input: SourceCommentInput): Promise<NormalizedSourceComment> {
    const { fetchImpl, headers, itemUrl } = gitLabOperation(input);
    const note = await requestJson<GitLabNote>(`${itemUrl}/notes`, headers, fetchImpl, {
      method: "POST",
      body: JSON.stringify({ body: input.body }),
    });
    return mapGitLabNote(note);
  }

  async setLabels(input: SourceSetLabelsInput): Promise<string[]> {
    const { fetchImpl, headers, itemUrl } = gitLabOperation(input);
    const item = await requestJson<{ labels?: string[] }>(itemUrl, headers, fetchImpl, {
      method: "PUT",
      body: JSON.stringify({
        add_labels: [...(input.add ?? [])].join(","),
        remove_labels: [...(input.remove ?? [])].join(","),
      }),
    });
    return item.labels ?? [];
  }

  async getDiff(input: SourceItemOperationInput): Promise<string> {
    const { fetchImpl, headers, itemUrl, parsed } = gitLabOperation(input);
    if (parsed.kind !== "pull-request") {
      throw new Error("GitLab diffs are only available for merge requests");
    }
    return requestText(
      `${itemUrl}/raw_diffs`,
      { ...headers, Accept: "text/plain" },
      fetchImpl,
    );
  }

  async getChecks(input: SourceItemOperationInput): Promise<SourceChecksResult> {
    const { fetchImpl, headers, itemUrl, parsed } = gitLabOperation(input);
    if (parsed.kind !== "pull-request") {
      throw new Error("GitLab checks are only available for merge requests");
    }
    const pipelines = await getAllPages<{
      id: number;
      status?: string;
      ref?: string;
      web_url?: string;
    }>(`${itemUrl}/pipelines?per_page=100`, headers, fetchImpl);
    const checks = pipelines.items.map((pipeline): NormalizedSourceCheck => {
      const status = pipeline.status?.toLowerCase() ?? "";
      const normalized: SourceCheckStatus =
        status === "success" || status === "skipped"
          ? "success"
          : ["failed", "canceled"].includes(status)
            ? "failure"
            : "pending";
      return {
        id: String(pipeline.id),
        name: `pipeline ${pipeline.ref ?? pipeline.id}`,
        status: normalized,
        details: pipeline.status ?? null,
        webUrl: pipeline.web_url ?? null,
      };
    });
    return { status: overallCheckStatus(checks), checks };
  }

  async mergePullRequest(
    input: SourceMergePullRequestInput,
  ): Promise<SourceMergePullRequestResult> {
    const { fetchImpl, headers, itemUrl, parsed } = gitLabOperation(input);
    if (parsed.kind !== "pull-request") {
      return { status: "blocked", detail: "GitLab can only merge merge requests" };
    }
    if (input.style === "rebase") {
      await requestJson<unknown>(`${itemUrl}/rebase`, headers, fetchImpl, {
        method: "POST",
      });
    }
    const response = await fetchImpl(`${itemUrl}/merge`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        squash: input.style === "squash",
        should_remove_source_branch: input.deleteBranch ?? false,
        merge_when_pipeline_succeeds: input.whenChecksSucceed ?? false,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      state?: string;
      merged_at?: string | null;
      merge_when_pipeline_succeeds?: boolean;
      message?: string;
      merge_commit_sha?: string | null;
    };
    const detail = body.message ?? (response.ok ? null : `GitLab merge failed (HTTP ${response.status})`);
    if (!response.ok) return { status: "blocked", detail };
    if (body.merged_at || body.state === "merged") {
      return { status: "merged", detail, mergeSha: body.merge_commit_sha ?? null };
    }
    if (body.merge_when_pipeline_succeeds || input.whenChecksSucceed) {
      return { status: "scheduled", detail };
    }
    return { status: "blocked", detail };
  }
}

interface GitHubPull {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  draft?: boolean;
  html_url?: string;
  updated_at?: string;
  user?: { login?: string; type?: string };
  labels?: Array<{ name?: string }>;
  mergeable_state?: string;
  merged?: boolean;
  pull_request?: unknown;
  node_id?: string;
  head?: {
    ref?: string;
    sha?: string;
    repo?: { full_name?: string };
  };
}

interface GitHubIssue extends GitHubPull {
  pull_request?: unknown;
}

interface GitHubComment {
  id: number;
  body?: string;
  user?: { login?: string };
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}

interface GitHubTimelineEvent {
  id: number;
  event?: string;
  label?: { name?: string };
  actor?: { login?: string };
  created_at?: string;
}

function gitHubOperation(input: SourceItemOperationInput): {
  fetchImpl: typeof fetch;
  headers: Record<string, string>;
  repositoryUrl: string;
  number: string;
  base: string;
} {
  if (!/^\d+$/.test(input.nativeKey)) {
    throw new Error(`Unsupported GitHub native key: ${input.kind}/${input.nativeKey}`);
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, "");
  return {
    fetchImpl,
    base,
    repositoryUrl: `${base}/repos/${input.externalKey}`,
    number: input.nativeKey,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    },
  };
}

function mapGitHubComment(comment: GitHubComment): NormalizedSourceComment {
  return {
    id: String(comment.id),
    body: comment.body ?? "",
    actor: comment.user?.login ?? null,
    createdAt: comment.created_at ?? "",
    updatedAt: comment.updated_at ?? null,
    webUrl: comment.html_url ?? null,
  };
}

function mapGitHubItem(
  item: GitHubPull,
  kind: "pull-request" | "issue",
  observedFallback: string,
): NormalizedSourceItem {
  return {
    kind,
    nativeKey: String(item.number),
    title: item.title,
    summary: item.body ?? "",
    delivery: deliveryFromState(kind, item.state, {
      ...(item.draft === undefined ? {} : { draft: item.draft }),
      merged: Boolean(item.merged),
    }),
    outcome: "pending",
    provenance: provenance({
      kind,
      author: item.user,
      headRef: item.head?.ref ?? null,
    }),
    actorName: item.user?.login ?? null,
    labels: (item.labels ?? []).flatMap((label) => (label.name ? [label.name] : [])),
    nativeState: item.state,
    nativeJson: JSON.stringify(item),
    webUrl: item.html_url ?? null,
    observedAt: item.updated_at ?? observedFallback,
    mergeability: item.mergeable_state ?? null,
  };
}

export class GitHubSourceAdapter implements SourceAdapter {
  readonly type = "github";
  readonly capabilities = REPOSITORY_CAPABILITIES;

  async listActive(input: SourceListInput): Promise<SourceListResult> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const base = input.baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    };
    const [pulls, allIssues] = await Promise.all([
      getAllPages<GitHubPull>(
        `${base}/repos/${input.externalKey}/pulls?state=open&per_page=100&sort=updated`,
        headers,
        fetchImpl,
      ),
      getAllPages<GitHubIssue>(
        `${base}/repos/${input.externalKey}/issues?state=open&per_page=100&sort=updated`,
        headers,
        fetchImpl,
      ),
    ]);
    const observedFallback = new Date().toISOString();
    return {
      items: [
        ...pulls.items.map((item) => mapGitHubItem(item, "pull-request", observedFallback)),
        ...allIssues.items
          .filter((item) => item.pull_request == null)
          .map((item) => mapGitHubItem(item, "issue", observedFallback)),
      ],
      cursor: null,
      backfillComplete: pulls.complete && allIssues.complete,
    };
  }

  async getItem(input: SourceGetItemInput): Promise<SourceGetItemResult> {
    if ((input.kind !== "pull-request" && input.kind !== "issue") || !/^\d+$/.test(input.nativeKey)) {
      return {
        status: "unresolved",
        detail: `Unsupported GitHub native key: ${input.kind}/${input.nativeKey}`,
      };
    }
    const fetchImpl = input.fetchImpl ?? fetch;
    const base = input.baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    };
    const path =
      input.kind === "pull-request"
        ? `pulls/${input.nativeKey}`
        : `issues/${input.nativeKey}`;
    const response = await getJsonResponse(
      `${base}/repos/${input.externalKey}/${path}`,
      headers,
      fetchImpl,
    );
    if (response.status === 404) {
      return {
        status: "unresolved",
        detail: `GitHub ${input.kind} ${input.nativeKey} was not found`,
      };
    }
    if (!response.ok) {
      return {
        status: "unresolved",
        detail: `GitHub item lookup failed (HTTP ${response.status})`,
      };
    }
    const item = (await response.json()) as GitHubPull;
    return {
      status: "found",
      item: mapGitHubItem(item, input.kind, new Date().toISOString()),
    };
  }

  async listComments(input: SourceItemOperationInput): Promise<NormalizedSourceComment[]> {
    const { fetchImpl, headers, repositoryUrl, number } = gitHubOperation(input);
    const result = await getAllPages<GitHubComment>(
      `${repositoryUrl}/issues/${number}/comments?per_page=100`,
      headers,
      fetchImpl,
    );
    return result.items.map(mapGitHubComment);
  }

  async listLabelActors(
    input: SourceItemOperationInput,
  ): Promise<NormalizedSourceLabelActor[]> {
    const { fetchImpl, headers, repositoryUrl, number } = gitHubOperation(input);
    const result = await getAllPages<GitHubTimelineEvent>(
      `${repositoryUrl}/issues/${number}/timeline?per_page=100`,
      headers,
      fetchImpl,
    );
    return result.items.flatMap((event) => {
      const label = event.label?.name;
      if (!label || (event.event !== "labeled" && event.event !== "unlabeled")) return [];
      return [{
        id: String(event.id),
        actor: event.actor?.login ?? null,
        action: event.event === "labeled" ? "added" as const : "removed" as const,
        label,
        occurredAt: event.created_at ?? "",
      }];
    });
  }

  async comment(input: SourceCommentInput): Promise<NormalizedSourceComment> {
    const { fetchImpl, headers, repositoryUrl, number } = gitHubOperation(input);
    const comment = await requestJson<GitHubComment>(
      `${repositoryUrl}/issues/${number}/comments`,
      headers,
      fetchImpl,
      { method: "POST", body: JSON.stringify({ body: input.body }) },
    );
    return mapGitHubComment(comment);
  }

  async setLabels(input: SourceSetLabelsInput): Promise<string[]> {
    const { fetchImpl, headers, repositoryUrl, number } = gitHubOperation(input);
    const issue = await getJson<{ labels?: Array<{ name?: string }> }>(
      `${repositoryUrl}/issues/${number}`,
      headers,
      fetchImpl,
    );
    const labels = updatedLabels(
      (issue.labels ?? []).flatMap((label) => (label.name ? [label.name] : [])),
      input.add,
      input.remove,
    );
    const updated = await requestJson<Array<{ name?: string }>>(
      `${repositoryUrl}/issues/${number}/labels`,
      headers,
      fetchImpl,
      { method: "PUT", body: JSON.stringify({ labels }) },
    );
    return updated.flatMap((label) => (label.name ? [label.name] : []));
  }

  async getDiff(input: SourceItemOperationInput): Promise<string> {
    if (input.kind !== "pull-request") {
      throw new Error("GitHub diffs are only available for pull requests");
    }
    const { fetchImpl, headers, repositoryUrl, number } = gitHubOperation(input);
    return requestText(
      `${repositoryUrl}/pulls/${number}`,
      { ...headers, Accept: "application/vnd.github.diff" },
      fetchImpl,
    );
  }

  async getChecks(input: SourceItemOperationInput): Promise<SourceChecksResult> {
    if (input.kind !== "pull-request") {
      throw new Error("GitHub checks are only available for pull requests");
    }
    const { fetchImpl, headers, repositoryUrl, number } = gitHubOperation(input);
    const pull = await getJson<GitHubPull>(
      `${repositoryUrl}/pulls/${number}`,
      headers,
      fetchImpl,
    );
    if (!pull.head?.sha) throw new Error(`GitHub pull request ${number} has no head SHA`);
    const result = await getJson<{
      check_runs?: Array<{
        id: number;
        name?: string;
        status?: string;
        conclusion?: string | null;
        details_url?: string;
        output?: { summary?: string | null; text?: string | null };
      }>;
    }>(`${repositoryUrl}/commits/${pull.head.sha}/check-runs?per_page=100`, headers, fetchImpl);
    const checks = (result.check_runs ?? []).map((check): NormalizedSourceCheck => {
      const conclusion = check.conclusion?.toLowerCase();
      const normalized: SourceCheckStatus =
        check.status !== "completed" || !conclusion
          ? "pending"
          : ["success", "neutral", "skipped"].includes(conclusion)
            ? "success"
            : "failure";
      return {
        id: String(check.id),
        name: check.name ?? `check ${check.id}`,
        status: normalized,
        details: check.output?.summary ?? check.output?.text ?? null,
        webUrl: check.details_url ?? null,
      };
    });
    return { status: overallCheckStatus(checks), checks };
  }

  async mergePullRequest(
    input: SourceMergePullRequestInput,
  ): Promise<SourceMergePullRequestResult> {
    const { fetchImpl, headers, repositoryUrl, number, base } = gitHubOperation(input);
    const pull = await getJson<GitHubPull>(
      `${repositoryUrl}/pulls/${number}`,
      headers,
      fetchImpl,
    );
    if (input.whenChecksSucceed) {
      if (!pull.node_id) {
        return { status: "blocked", detail: "GitHub pull request has no GraphQL node ID" };
      }
      const graphqlUrl = base.endsWith("/api/v3")
        ? `${base.slice(0, -"/api/v3".length)}/api/graphql`
        : `${base}/graphql`;
      const response = await fetchImpl(graphqlUrl, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) { enablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId, mergeMethod: $mergeMethod}) { pullRequest { autoMergeRequest { enabledAt } } } }",
          variables: {
            pullRequestId: pull.node_id,
            mergeMethod: input.style.toUpperCase(),
          },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: { enablePullRequestAutoMerge?: { pullRequest?: { autoMergeRequest?: unknown } } };
        errors?: Array<{ message?: string }>;
        message?: string;
      };
      const detail = body.errors?.map((error) => error.message).filter(Boolean).join("; ")
        || body.message
        || null;
      if (!response.ok || body.errors?.length) return { status: "blocked", detail };
      return { status: "scheduled", detail };
    }

    const response = await fetchImpl(`${repositoryUrl}/pulls/${number}/merge`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ merge_method: input.style }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      merged?: boolean;
      message?: string;
      sha?: string | null;
    };
    const detail = body.message ?? (response.ok ? null : `GitHub merge failed (HTTP ${response.status})`);
    if (!response.ok || !body.merged) return { status: "blocked", detail };

    if (
      input.deleteBranch &&
      pull.head?.ref &&
      pull.head.repo?.full_name === input.externalKey
    ) {
      const encodedRef = pull.head.ref.split("/").map(encodeURIComponent).join("/");
      const deleteResponse = await fetchImpl(`${repositoryUrl}/git/refs/heads/${encodedRef}`, {
        method: "DELETE",
        headers,
      });
      if (!deleteResponse.ok && deleteResponse.status !== 422) {
        return {
          status: "merged",
          detail: `${detail ?? "Merged"}; branch deletion failed (HTTP ${deleteResponse.status})`,
          mergeSha: body.sha ?? null,
        };
      }
    }
    return { status: "merged", detail, mergeSha: body.sha ?? null };
  }
}

interface ForgejoItem {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  draft?: boolean;
  html_url?: string;
  updated_at?: string;
  user?: { login?: string; type?: string };
  labels?: Array<{ name?: string }>;
  mergeable?: boolean;
  merged?: boolean;
  head?: { ref?: string; sha?: string };
}

interface ForgejoComment {
  id: number;
  body?: string;
  user?: { login?: string };
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}

interface ForgejoLabel {
  id: number;
  name?: string;
}

interface ForgejoTimelineEvent {
  id: number;
  type?: string;
  label?: { name?: string };
  user?: { login?: string };
  created_at?: string;
}

function forgejoOperation(input: SourceItemOperationInput): {
  fetchImpl: typeof fetch;
  headers: Record<string, string>;
  repositoryUrl: string;
  number: string;
} {
  if (!/^\d+$/.test(input.nativeKey)) {
    throw new Error(`Unsupported Forgejo native key: ${input.kind}/${input.nativeKey}`);
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, "");
  const api = base.endsWith("/api/v1") ? base : `${base}/api/v1`;
  return {
    fetchImpl,
    repositoryUrl: `${api}/repos/${input.externalKey}`,
    number: input.nativeKey,
    headers: {
      Accept: "application/json",
      ...(input.token ? { Authorization: `token ${input.token}` } : {}),
    },
  };
}

function mapForgejoComment(comment: ForgejoComment): NormalizedSourceComment {
  return {
    id: String(comment.id),
    body: comment.body ?? "",
    actor: comment.user?.login ?? null,
    createdAt: comment.created_at ?? "",
    updatedAt: comment.updated_at ?? null,
    webUrl: comment.html_url ?? null,
  };
}

function mapForgejoItem(
  item: ForgejoItem,
  kind: "pull-request" | "issue",
  observedFallback: string,
): NormalizedSourceItem {
  return {
    kind,
    nativeKey: String(item.number),
    title: item.title,
    summary: item.body ?? "",
    delivery: deliveryFromState(kind, item.state, {
      ...(item.draft === undefined ? {} : { draft: item.draft }),
      merged: Boolean(item.merged),
    }),
    outcome: "pending",
    provenance: provenance({
      kind,
      author: item.user,
      headRef: item.head?.ref ?? null,
    }),
    actorName: item.user?.login ?? null,
    labels: (item.labels ?? []).flatMap((label) => (label.name ? [label.name] : [])),
    nativeState: item.state,
    nativeJson: JSON.stringify(item),
    webUrl: item.html_url ?? null,
    observedAt: item.updated_at ?? observedFallback,
    mergeability:
      item.mergeable === undefined ? null : item.mergeable ? "mergeable" : "conflicting",
  };
}

export class ForgejoSourceAdapter implements SourceAdapter {
  readonly type = "forgejo";
  readonly capabilities = REPOSITORY_CAPABILITIES;

  async listActive(input: SourceListInput): Promise<SourceListResult> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const base = input.baseUrl.replace(/\/+$/, "");
    const api = base.endsWith("/api/v1") ? base : `${base}/api/v1`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(input.token ? { Authorization: `token ${input.token}` } : {}),
    };
    const [pulls, issues] = await Promise.all([
      getAllPages<ForgejoItem>(
        `${api}/repos/${input.externalKey}/pulls?state=open&limit=100`,
        headers,
        fetchImpl,
      ),
      getAllPages<ForgejoItem>(
        `${api}/repos/${input.externalKey}/issues?state=open&limit=100&type=issues`,
        headers,
        fetchImpl,
      ),
    ]);
    const observedFallback = new Date().toISOString();
    return {
      items: [
        ...pulls.items.map((item) => mapForgejoItem(item, "pull-request", observedFallback)),
        ...issues.items.map((item) => mapForgejoItem(item, "issue", observedFallback)),
      ],
      cursor: null,
      backfillComplete: pulls.complete && issues.complete,
    };
  }

  async getItem(input: SourceGetItemInput): Promise<SourceGetItemResult> {
    if ((input.kind !== "pull-request" && input.kind !== "issue") || !/^\d+$/.test(input.nativeKey)) {
      return {
        status: "unresolved",
        detail: `Unsupported Forgejo native key: ${input.kind}/${input.nativeKey}`,
      };
    }
    const fetchImpl = input.fetchImpl ?? fetch;
    const base = input.baseUrl.replace(/\/+$/, "");
    const api = base.endsWith("/api/v1") ? base : `${base}/api/v1`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(input.token ? { Authorization: `token ${input.token}` } : {}),
    };
    const path =
      input.kind === "pull-request"
        ? `pulls/${input.nativeKey}`
        : `issues/${input.nativeKey}`;
    const response = await getJsonResponse(
      `${api}/repos/${input.externalKey}/${path}`,
      headers,
      fetchImpl,
    );
    if (response.status === 404) {
      return {
        status: "unresolved",
        detail: `Forgejo ${input.kind} ${input.nativeKey} was not found`,
      };
    }
    if (!response.ok) {
      return {
        status: "unresolved",
        detail: `Forgejo item lookup failed (HTTP ${response.status})`,
      };
    }
    const item = (await response.json()) as ForgejoItem;
    return {
      status: "found",
      item: mapForgejoItem(item, input.kind, new Date().toISOString()),
    };
  }

  async listComments(input: SourceItemOperationInput): Promise<NormalizedSourceComment[]> {
    const { fetchImpl, headers, repositoryUrl, number } = forgejoOperation(input);
    const result = await getAllPages<ForgejoComment>(
      `${repositoryUrl}/issues/${number}/comments?limit=100`,
      headers,
      fetchImpl,
    );
    return result.items.map(mapForgejoComment);
  }

  async listLabelActors(
    input: SourceItemOperationInput,
  ): Promise<NormalizedSourceLabelActor[]> {
    const { fetchImpl, headers, repositoryUrl, number } = forgejoOperation(input);
    const result = await getAllPages<ForgejoTimelineEvent>(
      `${repositoryUrl}/issues/${number}/timeline?limit=100`,
      headers,
      fetchImpl,
    );
    return result.items.flatMap((event) => {
      const label = event.label?.name;
      const action =
        event.type === "label"
          ? "added"
          : event.type === "unlabel" || event.type === "label_removed"
            ? "removed"
            : null;
      if (!label || !action) return [];
      return [{
        id: String(event.id),
        actor: event.user?.login ?? null,
        action,
        label,
        occurredAt: event.created_at ?? "",
      }];
    });
  }

  async comment(input: SourceCommentInput): Promise<NormalizedSourceComment> {
    const { fetchImpl, headers, repositoryUrl, number } = forgejoOperation(input);
    const comment = await requestJson<ForgejoComment>(
      `${repositoryUrl}/issues/${number}/comments`,
      headers,
      fetchImpl,
      { method: "POST", body: JSON.stringify({ body: input.body }) },
    );
    return mapForgejoComment(comment);
  }

  async setLabels(input: SourceSetLabelsInput): Promise<string[]> {
    const { fetchImpl, headers, repositoryUrl, number } = forgejoOperation(input);
    const issue = await getJson<{ labels?: ForgejoLabel[] }>(
      `${repositoryUrl}/issues/${number}`,
      headers,
      fetchImpl,
    );
    const labels = await getAllPages<ForgejoLabel>(
      `${repositoryUrl}/labels?limit=100`,
      headers,
      fetchImpl,
    );
    const desiredNames = updatedLabels(
      (issue.labels ?? []).flatMap((label) => (label.name ? [label.name] : [])),
      input.add,
      input.remove,
    );
    const labelsByName = new Map(
      labels.items.flatMap((label) => (label.name ? [[label.name, label.id] as const] : [])),
    );
    const missing = desiredNames.filter((label) => !labelsByName.has(label));
    if (missing.length > 0) {
      throw new Error(`Forgejo labels not found: ${missing.join(", ")}`);
    }
    const updated = await requestJson<{ labels?: ForgejoLabel[] }>(
      `${repositoryUrl}/issues/${number}`,
      headers,
      fetchImpl,
      {
        method: "PATCH",
        body: JSON.stringify({ labels: desiredNames.map((label) => labelsByName.get(label)) }),
      },
    );
    return (updated.labels ?? []).flatMap((label) => (label.name ? [label.name] : []));
  }

  async getDiff(input: SourceItemOperationInput): Promise<string> {
    if (input.kind !== "pull-request") {
      throw new Error("Forgejo diffs are only available for pull requests");
    }
    const { fetchImpl, headers, repositoryUrl, number } = forgejoOperation(input);
    return requestText(
      `${repositoryUrl}/pulls/${number}.diff`,
      { ...headers, Accept: "text/plain" },
      fetchImpl,
    );
  }

  async getChecks(input: SourceItemOperationInput): Promise<SourceChecksResult> {
    if (input.kind !== "pull-request") {
      throw new Error("Forgejo checks are only available for pull requests");
    }
    const { fetchImpl, headers, repositoryUrl, number } = forgejoOperation(input);
    const pull = await getJson<ForgejoItem>(
      `${repositoryUrl}/pulls/${number}`,
      headers,
      fetchImpl,
    );
    if (!pull.head?.sha) throw new Error(`Forgejo pull request ${number} has no head SHA`);
    const result = await getJson<{
      statuses?: Array<{
        id: number;
        context?: string;
        status?: string;
        state?: string;
        description?: string;
        target_url?: string;
      }>;
    }>(`${repositoryUrl}/commits/${pull.head.sha}/status`, headers, fetchImpl);
    const checks = (result.statuses ?? []).map((check): NormalizedSourceCheck => {
      const status = (check.status ?? check.state ?? "").toLowerCase();
      const normalized: SourceCheckStatus =
        ["success", "neutral", "skipped"].includes(status)
          ? "success"
          : ["failure", "error", "failed", "cancelled", "canceled"].includes(status)
            ? "failure"
            : "pending";
      return {
        id: String(check.id),
        name: check.context ?? `check ${check.id}`,
        status: normalized,
        details: check.description ?? null,
        webUrl: check.target_url ?? null,
      };
    });
    return { status: overallCheckStatus(checks), checks };
  }

  async mergePullRequest(
    input: SourceMergePullRequestInput,
  ): Promise<SourceMergePullRequestResult> {
    const { fetchImpl, headers, repositoryUrl, number } = forgejoOperation(input);
    const response = await fetchImpl(`${repositoryUrl}/pulls/${number}/merge`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        Do: input.style,
        merge_when_checks_succeed: input.whenChecksSucceed ?? false,
        delete_branch_after_merge: input.deleteBranch ?? false,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      merged?: boolean;
      message?: string;
      sha?: string | null;
    };
    const detail = body.message ?? (response.ok ? null : `Forgejo merge failed (HTTP ${response.status})`);
    if (!response.ok) return { status: "blocked", detail };
    if (body.merged || !input.whenChecksSucceed) {
      return { status: "merged", detail, mergeSha: body.sha ?? null };
    }
    return { status: "scheduled", detail };
  }
}

export class GenericWebhookSourceAdapter implements SourceAdapter {
  readonly type = "generic-webhook";
  readonly capabilities: SourceCapabilities = {
    read: false,
    list: false,
    webhooks: true,
    write: false,
    workKinds: [],
  };

  async listActive(_input: SourceListInput): Promise<SourceListResult> {
    return { items: [], cursor: null, backfillComplete: true };
  }
}
