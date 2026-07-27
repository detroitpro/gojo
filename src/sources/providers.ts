import type { SourceCapabilities, WorkProvenance } from "@shared/work";

import type {
  NormalizedSourceItem,
  SourceAdapter,
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

function provenance(author: { bot?: boolean; type?: string } | null | undefined): WorkProvenance {
  return author?.bot || author?.type?.toLowerCase() === "bot" ? "bot" : "human";
}

async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`Source sync failed (HTTP ${response.status}) for ${url}`);
  }
  return (await response.json()) as T;
}

async function getAllPages<T>(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const batch = await getJson<T[]>(
      `${url}${url.includes("?") ? "&" : "?"}page=${page}`,
      headers,
      fetchImpl,
    );
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
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
    const map = (item: GitLabItem, kind: "pull-request" | "issue"): NormalizedSourceItem => ({
      kind,
      // GitLab allocates issue and merge-request IIDs independently.
      nativeKey: `${kind}:${item.iid}`,
      title: item.title,
      summary: item.description ?? "",
      delivery: kind === "pull-request" && item.draft ? "draft" : "open",
      outcome: "pending",
      provenance: provenance(item.author),
      actorName: item.author?.name ?? item.author?.username ?? null,
      labels: item.labels ?? [],
      nativeState: item.state,
      nativeJson: JSON.stringify(item),
      webUrl: item.web_url ?? null,
      observedAt: item.updated_at ?? observedFallback,
      mergeability: item.merge_status ?? null,
    });
    return {
      items: [
        ...mergeRequests.map((item) => map(item, "pull-request")),
        ...issues.map((item) => map(item, "issue")),
      ],
      cursor: null,
      backfillComplete: false,
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
}

interface GitHubIssue extends GitHubPull {
  pull_request?: unknown;
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
    const map = (item: GitHubPull, kind: "pull-request" | "issue"): NormalizedSourceItem => ({
      kind,
      nativeKey: String(item.number),
      title: item.title,
      summary: item.body ?? "",
      delivery: kind === "pull-request" && item.draft ? "draft" : "open",
      outcome: "pending",
      provenance: provenance(item.user),
      actorName: item.user?.login ?? null,
      labels: (item.labels ?? []).flatMap((label) => (label.name ? [label.name] : [])),
      nativeState: item.state,
      nativeJson: JSON.stringify(item),
      webUrl: item.html_url ?? null,
      observedAt: item.updated_at ?? observedFallback,
      mergeability: item.mergeable_state ?? null,
    });
    return {
      items: [
        ...pulls.map((item) => map(item, "pull-request")),
        ...allIssues
          .filter((item) => item.pull_request == null)
          .map((item) => map(item, "issue")),
      ],
      cursor: null,
      backfillComplete: false,
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
    const map = (item: ForgejoItem, kind: "pull-request" | "issue"): NormalizedSourceItem => ({
      kind,
      nativeKey: String(item.number),
      title: item.title,
      summary: item.body ?? "",
      delivery: kind === "pull-request" && item.draft ? "draft" : "open",
      outcome: "pending",
      provenance: provenance(item.user),
      actorName: item.user?.login ?? null,
      labels: (item.labels ?? []).flatMap((label) => (label.name ? [label.name] : [])),
      nativeState: item.state,
      nativeJson: JSON.stringify(item),
      webUrl: item.html_url ?? null,
      observedAt: item.updated_at ?? observedFallback,
      mergeability:
        item.mergeable === undefined ? null : item.mergeable ? "mergeable" : "conflicting",
    });
    return {
      items: [
        ...pulls.map((item) => map(item, "pull-request")),
        ...issues.map((item) => map(item, "issue")),
      ],
      cursor: null,
      backfillComplete: false,
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
