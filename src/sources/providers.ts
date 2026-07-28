import type { SourceCapabilities, WorkDelivery, WorkProvenance } from "@shared/work";

import type {
  NormalizedSourceItem,
  SourceAdapter,
  SourceGetItemInput,
  SourceGetItemResult,
  SourceListInput,
  SourceListResult,
} from "./types";

const REPOSITORY_CAPABILITIES: SourceCapabilities = {
  read: true,
  list: true,
  webhooks: true,
  write: false,
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
  head?: { ref?: string };
}

interface GitHubIssue extends GitHubPull {
  pull_request?: unknown;
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
  head?: { ref?: string };
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
