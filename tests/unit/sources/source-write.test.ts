import { describe, expect, test } from "bun:test";

import {
  ForgejoSourceAdapter,
  GenericWebhookSourceAdapter,
  GitHubSourceAdapter,
  GitLabSourceAdapter,
} from "@/sources";

function requestBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

describe("sources/GitHub write adapter", () => {
  test("normalizes comments, labels, diffs, checks, and merge mutations", async () => {
    const adapter = new GitHubSourceAdapter();
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/issues/12/comments")) {
        if (init?.method === "POST") {
          return Response.json({
            id: 2,
            body: "Ship it",
            user: { login: "gojo" },
            created_at: "2026-07-30T18:00:00.000Z",
            html_url: "https://github.com/acme/app/issues/12#issuecomment-2",
          });
        }
        return Response.json([
          {
            id: 1,
            body: "Ready",
            user: { login: "reviewer" },
            created_at: "2026-07-30T17:00:00.000Z",
          },
        ]);
      }
      if (url.includes("/issues/12/timeline?")) {
        return Response.json([
          {
            id: 3,
            event: "labeled",
            label: { name: "status:ready" },
            actor: { login: "operator" },
            created_at: "2026-07-30T17:30:00.000Z",
          },
          {
            id: 4,
            event: "unlabeled",
            label: { name: "status:blocked" },
            actor: { login: "operator" },
            created_at: "2026-07-30T17:31:00.000Z",
          },
        ]);
      }
      if (url.endsWith("/issues/12") && init?.method !== "PUT") {
        return Response.json({ labels: [{ name: "keep" }, { name: "remove" }] });
      }
      if (url.endsWith("/issues/12/labels") && init?.method === "PUT") {
        return Response.json([{ name: "keep" }, { name: "add" }]);
      }
      if (url.endsWith("/pulls/12") && init?.headers) {
        const accept = new Headers(init.headers).get("Accept");
        if (accept === "application/vnd.github.diff") {
          return new Response("diff --git a/a.ts b/a.ts");
        }
      }
      if (url.endsWith("/pulls/12")) {
        return Response.json({
          node_id: "PR_node",
          head: { ref: "gojo/ship", sha: "abc123", repo: { full_name: "acme/app" } },
        });
      }
      if (url.endsWith("/commits/abc123/check-runs?per_page=100")) {
        return Response.json({
          check_runs: [
            {
              id: 5,
              name: "test",
              status: "completed",
              conclusion: "success",
              details_url: "https://github.com/acme/app/actions/runs/5",
              output: { summary: "All tests passed" },
            },
          ],
        });
      }
      if (url.endsWith("/pulls/12/merge")) {
        return Response.json({ merged: true, message: "Pull Request successfully merged", sha: "def456" });
      }
      if (url.includes("/git/refs/heads/")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected GitHub request: ${init?.method ?? "GET"} ${url}`);
    }) as typeof fetch;
    const base = {
      baseUrl: "https://api.github.com",
      externalKey: "acme/app",
      kind: "pull-request" as const,
      nativeKey: "12",
      token: "token",
      fetchImpl,
    };

    expect(adapter.capabilities.write).toBe(true);
    expect(await adapter.listComments!(base)).toEqual([
      expect.objectContaining({ id: "1", body: "Ready", actor: "reviewer" }),
    ]);
    expect(await adapter.listLabelActors!(base)).toEqual([
      expect.objectContaining({ action: "added", label: "status:ready", actor: "operator" }),
      expect.objectContaining({ action: "removed", label: "status:blocked", actor: "operator" }),
    ]);
    expect(await adapter.comment!({ ...base, body: "Ship it" })).toMatchObject({
      id: "2",
      body: "Ship it",
      actor: "gojo",
    });
    expect(
      await adapter.setLabels!({ ...base, add: ["add"], remove: ["remove"] }),
    ).toEqual(["keep", "add"]);
    expect(await adapter.getDiff!(base)).toBe("diff --git a/a.ts b/a.ts");
    expect(await adapter.getChecks!(base)).toEqual({
      status: "success",
      checks: [
        expect.objectContaining({
          id: "5",
          name: "test",
          status: "success",
          details: "All tests passed",
        }),
      ],
    });
    expect(
      await adapter.mergePullRequest!({
        ...base,
        style: "squash",
        deleteBranch: true,
      }),
    ).toEqual({
      status: "merged",
      detail: "Pull Request successfully merged",
      mergeSha: "def456",
    });

    expect(
      requests.some(
        ({ url, init }) =>
          url.endsWith("/issues/12/labels") &&
          init?.method === "PUT" &&
          JSON.stringify(requestBody(init)["labels"]) === JSON.stringify(["keep", "add"]),
      ),
    ).toBe(true);
    expect(
      requests.some(
        ({ url, init }) =>
          url.endsWith("/pulls/12/merge") &&
          init?.method === "PUT" &&
          requestBody(init)["merge_method"] === "squash",
      ),
    ).toBe(true);
  });
});

describe("sources/Forgejo write adapter", () => {
  test("uses Gitea-compatible issue and pull request APIs", async () => {
    const adapter = new ForgejoSourceAdapter();
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/issues/9/comments")) {
        if (init?.method === "POST") {
          return Response.json({
            id: 2,
            body: "Queued",
            user: { login: "gojo" },
            created_at: "2026-07-30T18:00:00.000Z",
          });
        }
        return Response.json([
          {
            id: 1,
            body: "Ready",
            user: { login: "reviewer" },
            created_at: "2026-07-30T17:00:00.000Z",
          },
        ]);
      }
      if (url.includes("/issues/9/timeline?")) {
        return Response.json([
          {
            id: 3,
            type: "label",
            label: { name: "status:ready" },
            user: { login: "operator" },
            created_at: "2026-07-30T17:30:00.000Z",
          },
        ]);
      }
      if (url.endsWith("/issues/9") && init?.method !== "PATCH") {
        return Response.json({ labels: [{ id: 10, name: "keep" }, { id: 11, name: "remove" }] });
      }
      if (url.includes("/labels?limit=100")) {
        return Response.json([
          { id: 10, name: "keep" },
          { id: 11, name: "remove" },
          { id: 12, name: "add" },
        ]);
      }
      if (url.endsWith("/issues/9") && init?.method === "PATCH") {
        return Response.json({ labels: [{ id: 10, name: "keep" }, { id: 12, name: "add" }] });
      }
      if (url.endsWith("/pulls/9.diff")) {
        return new Response("diff --git a/a.ts b/a.ts");
      }
      if (url.endsWith("/pulls/9")) {
        return Response.json({ head: { sha: "abc123" } });
      }
      if (url.endsWith("/commits/abc123/status")) {
        return Response.json({
          state: "pending",
          statuses: [
            {
              id: 4,
              context: "ci/test",
              status: "pending",
              description: "Running",
              target_url: "https://forge.example/acme/app/actions/4",
            },
          ],
        });
      }
      if (url.endsWith("/pulls/9/merge")) {
        return Response.json({ merged: false, message: "auto merge scheduled" });
      }
      throw new Error(`Unexpected Forgejo request: ${init?.method ?? "GET"} ${url}`);
    }) as typeof fetch;
    const base = {
      baseUrl: "https://forge.example",
      externalKey: "acme/app",
      kind: "pull-request" as const,
      nativeKey: "9",
      token: "token",
      fetchImpl,
    };

    expect(adapter.capabilities.write).toBe(true);
    expect(await adapter.listComments!(base)).toEqual([
      expect.objectContaining({ id: "1", actor: "reviewer" }),
    ]);
    expect(await adapter.listLabelActors!(base)).toEqual([
      expect.objectContaining({ action: "added", label: "status:ready", actor: "operator" }),
    ]);
    expect(await adapter.comment!({ ...base, body: "Queued" })).toMatchObject({
      id: "2",
      actor: "gojo",
    });
    expect(
      await adapter.setLabels!({ ...base, add: ["add"], remove: ["remove"] }),
    ).toEqual(["keep", "add"]);
    expect(await adapter.getDiff!(base)).toBe("diff --git a/a.ts b/a.ts");
    expect(await adapter.getChecks!(base)).toEqual({
      status: "pending",
      checks: [
        expect.objectContaining({
          id: "4",
          name: "ci/test",
          status: "pending",
          details: "Running",
        }),
      ],
    });
    expect(
      await adapter.mergePullRequest!({
        ...base,
        style: "rebase",
        deleteBranch: true,
        whenChecksSucceed: true,
      }),
    ).toEqual({ status: "scheduled", detail: "auto merge scheduled" });

    expect(
      requests.some(
        ({ url, init }) =>
          url.endsWith("/issues/9") &&
          init?.method === "PATCH" &&
          JSON.stringify(requestBody(init)["labels"]) === JSON.stringify([10, 12]),
      ),
    ).toBe(true);
    expect(
      requests.some(({ url, init }) => {
        if (!url.endsWith("/pulls/9/merge") || init?.method !== "POST") return false;
        const body = requestBody(init);
        return (
          body["Do"] === "rebase" &&
          body["merge_when_checks_succeed"] === true &&
          body["delete_branch_after_merge"] === true
        );
      }),
    ).toBe(true);
  });
});

describe("sources/GitLab write adapter", () => {
  test("uses project-scoped notes, events, pipelines, and merge APIs", async () => {
    const adapter = new GitLabSourceAdapter();
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/merge_requests/7/notes")) {
        if (init?.method === "POST") {
          return Response.json({
            id: 2,
            body: "Queued",
            author: { username: "gojo" },
            created_at: "2026-07-30T18:00:00.000Z",
          });
        }
        return Response.json([
          {
            id: 1,
            body: "Ready",
            author: { username: "reviewer" },
            created_at: "2026-07-30T17:00:00.000Z",
          },
        ]);
      }
      if (url.includes("/merge_requests/7/resource_label_events?")) {
        return Response.json([
          {
            id: 3,
            action: "add",
            label: { name: "status:ready" },
            user: { username: "operator" },
            created_at: "2026-07-30T17:30:00.000Z",
          },
        ]);
      }
      if (url.endsWith("/merge_requests/7/raw_diffs")) {
        return new Response("diff --git a/a.ts b/a.ts");
      }
      if (url.includes("/merge_requests/7/pipelines?")) {
        return Response.json([
          {
            id: 4,
            status: "success",
            ref: "gojo/ship",
            web_url: "https://gitlab.example.com/acme/app/-/pipelines/4",
          },
        ]);
      }
      if (url.endsWith("/merge_requests/7/merge")) {
        return Response.json({
          state: "opened",
          merge_when_pipeline_succeeds: true,
          message: "Merge scheduled",
        });
      }
      if (url.endsWith("/merge_requests/7") && init?.method === "PUT") {
        return Response.json({ labels: ["keep", "add"] });
      }
      throw new Error(`Unexpected GitLab request: ${init?.method ?? "GET"} ${url}`);
    }) as typeof fetch;
    const base = {
      baseUrl: "https://gitlab.example.com",
      externalKey: "acme/app",
      kind: "pull-request" as const,
      nativeKey: "pull-request:7",
      token: "token",
      fetchImpl,
    };

    expect(adapter.capabilities.write).toBe(true);
    expect(await adapter.listComments!(base)).toEqual([
      expect.objectContaining({ id: "1", actor: "reviewer" }),
    ]);
    expect(await adapter.listLabelActors!(base)).toEqual([
      expect.objectContaining({ action: "added", label: "status:ready", actor: "operator" }),
    ]);
    expect(await adapter.comment!({ ...base, body: "Queued" })).toMatchObject({
      id: "2",
      actor: "gojo",
    });
    expect(
      await adapter.setLabels!({ ...base, add: ["add"], remove: ["remove"] }),
    ).toEqual(["keep", "add"]);
    expect(await adapter.getDiff!(base)).toBe("diff --git a/a.ts b/a.ts");
    expect(await adapter.getChecks!(base)).toEqual({
      status: "success",
      checks: [
        expect.objectContaining({
          id: "4",
          name: "pipeline gojo/ship",
          status: "success",
        }),
      ],
    });
    expect(
      await adapter.mergePullRequest!({
        ...base,
        style: "squash",
        deleteBranch: true,
        whenChecksSucceed: true,
      }),
    ).toEqual({ status: "scheduled", detail: "Merge scheduled" });

    expect(
      requests.some(({ url, init }) => {
        if (!url.endsWith("/merge_requests/7") || init?.method !== "PUT") return false;
        const body = requestBody(init);
        return body["add_labels"] === "add" && body["remove_labels"] === "remove";
      }),
    ).toBe(true);
    expect(
      requests.some(({ url, init }) => {
        if (!url.endsWith("/merge_requests/7/merge") || init?.method !== "PUT") return false;
        const body = requestBody(init);
        return (
          body["squash"] === true &&
          body["should_remove_source_branch"] === true &&
          body["merge_when_pipeline_succeeds"] === true
        );
      }),
    ).toBe(true);
  });
});

describe("sources/generic webhook adapter", () => {
  test("remains read-only", () => {
    const adapter = new GenericWebhookSourceAdapter();
    expect(adapter.capabilities.write).toBe(false);
    expect("comment" in adapter).toBe(false);
    expect("mergePullRequest" in adapter).toBe(false);
  });
});
