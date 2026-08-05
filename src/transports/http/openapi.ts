import {
  getUseCaseRegistry,
  mergeOpenApiPaths,
  openApiPathsFromRegistry,
} from "@/platform";

/**
 * Hand-written base paths for routes not yet on the use-case registry.
 * @removal(when: all HTTP routes registered): delete this base object; serve
 * only `openApiPathsFromRegistry(getUseCaseRegistry())` — removal-backlog R3
 */
const legacyOpenApiPaths = {
  "/api/v1/ws": {
    get: {
      summary: "WebSocket realtime + RPC transport",
      description:
        "Authenticated WebSocket. Carries platform invalidation events, run activity streams, and request/response RPC frames for browser clients. Agents, webhooks, and CLI health remain on HTTP.",
    },
  },
  "/api/v1/health": {
    get: { summary: "Health check" },
  },
  "/api/v1/setup": {
    post: { summary: "First-run admin setup" },
  },
  "/api/v1/auth/login": {
    post: { summary: "Create session cookie" },
  },
  "/api/v1/auth/logout": {
    post: { summary: "Clear session cookie" },
  },
  "/api/v1/auth/me": {
    get: { summary: "Current authenticated user" },
  },
  "/api/v1/auth/password": {
    post: {
      summary: "Change password",
      description:
        "Requires currentPassword and newPassword. Invalidates session cookies issued before the change; API tokens remain valid.",
    },
  },
  "/api/v1/auth/tokens": {
    get: {
      summary: "List API tokens",
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer" } },
        { name: "offset", in: "query", schema: { type: "integer" } },
        { name: "q", in: "query", schema: { type: "string" } },
      ],
    },
    post: { summary: "Create API token" },
  },
  "/api/v1/auth/tokens/{id}": {
    delete: { summary: "Revoke API token" },
  },
  "/api/v1/projects": {
    get: {
      summary: "List projects",
      parameters: [
        { name: "limit", in: "query", schema: { type: "integer" } },
        { name: "offset", in: "query", schema: { type: "integer" } },
        { name: "q", in: "query", schema: { type: "string" } },
        {
          name: "hasOpenPrs",
          in: "query",
          schema: { type: "string", enum: ["0", "1"] },
        },
      ],
    },
    post: { summary: "Register a project" },
  },
  "/api/v1/integrations": {
    get: {
      summary: "List integrations",
      parameters: [
        {
          name: "status",
          in: "query",
          required: true,
          schema: { type: "string", enum: ["open", "merged", "committed"] },
        },
      ],
    },
  },
  "/api/v1/impact/items": {
    get: { summary: "List impact items" },
  },
  "/api/v1/projects/{id}": {
    get: { summary: "Get project" },
    delete: { summary: "Delete project" },
  },
  "/api/v1/projects/{id}/sync": {
    post: { summary: "Sync project from gojo.yaml" },
  },
  "/api/v1/projects/{id}/doctor": {
    get: { summary: "Project diagnostics" },
  },
  "/api/v1/projects/{id}/work": {
    get: { summary: "List project work items" },
  },
  "/api/v1/projects/{id}/work/status": {
    get: { summary: "Project work status rollup" },
  },
  "/api/v1/projects/{id}/sources": {
    get: { summary: "List project sources" },
  },
  "/api/v1/projects/{id}/sources/{sourceId}/refresh": {
    post: { summary: "Refresh a project source" },
  },
  "/api/v1/work/{id}": {
    get: { summary: "Get work item" },
  },
  "/api/v1/work/{id}/recheck": {
    post: { summary: "Recheck work item" },
  },
  "/api/v1/work/{id}/resolve": {
    post: { summary: "Resolve work item" },
  },
  "/api/v1/work/{id}/diff": {
    get: { summary: "Work item diff" },
  },
  "/api/v1/adapters": {
    get: { summary: "List adapters" },
  },
  "/api/v1/adapters/{name}/test": {
    post: { summary: "Test an adapter" },
  },
  "/api/v1/agents": {
    get: { summary: "List agents" },
    post: { summary: "Create agent" },
  },
  "/api/v1/agents/{id}": {
    get: { summary: "Get agent" },
  },
  "/api/v1/agents/{id}/run": {
    post: { summary: "Enqueue agent run" },
  },
  "/api/v1/agents/{id}/enable": {
    post: { summary: "Enable agent" },
  },
  "/api/v1/agents/{id}/disable": {
    post: { summary: "Disable agent" },
  },
  "/api/v1/schedules": {
    get: { summary: "List schedules" },
  },
  "/api/v1/schedules/upcoming": {
    get: { summary: "Upcoming schedule firings" },
  },
  "/api/v1/schedules/{id}/enable": {
    post: { summary: "Enable schedule" },
  },
  "/api/v1/schedules/{id}/disable": {
    post: { summary: "Disable schedule" },
  },
  "/api/v1/schedules/{id}/pause": {
    post: { summary: "Pause schedule" },
  },
  "/api/v1/runs": {
    get: { summary: "List runs" },
  },
  "/api/v1/runs/{id}": {
    get: { summary: "Get run" },
  },
  "/api/v1/runs/{id}/progress": {
    post: { summary: "Update run progress" },
  },
  "/api/v1/runs/{id}/diff": {
    get: { summary: "Run diff" },
  },
  "/api/v1/runs/{id}/artifacts": {
    get: { summary: "Run artifacts" },
  },
  "/api/v1/runs/{id}/cancel": {
    post: { summary: "Cancel run" },
  },
  "/api/v1/runs/{id}/approve": {
    post: { summary: "Approve run" },
  },
  "/api/v1/runs/{id}/reject": {
    post: { summary: "Reject run" },
  },
  "/api/v1/runs/{id}/retry": {
    post: { summary: "Retry run" },
  },
  "/api/v1/approvals": {
    get: { summary: "List approvals" },
  },
  "/api/v1/approvals/{id}": {
    get: { summary: "Get approval" },
  },
  "/api/v1/approvals/{id}/approve": {
    post: { summary: "Approve" },
  },
  "/api/v1/approvals/{id}/approve-link": {
    get: { summary: "Single-use approve link page" },
    post: { summary: "Apply single-use approve link" },
  },
  "/api/v1/approvals/{id}/reject": {
    post: { summary: "Reject approval" },
  },
  "/api/v1/approvals/{id}/hold": {
    post: { summary: "Hold approval" },
  },
  "/api/v1/approvals/{id}/autonomy": {
    post: { summary: "Set approval autonomy" },
  },
  "/api/v1/control/intents": {
    post: { summary: "Submit control intent" },
  },
  "/api/v1/dashboard": {
    get: { summary: "Dashboard stats" },
  },
  "/api/v1/dashboard/overview": {
    get: { summary: "Dashboard overview" },
  },
  "/api/v1/dashboard/impact": {
    get: { summary: "Dashboard impact" },
  },
  "/api/v1/instance": {
    get: { summary: "Instance settings" },
    patch: { summary: "Update instance settings" },
  },
  "/api/v1/instance/doctor": {
    get: { summary: "Instance diagnostics" },
  },
  "/api/v1/instance/pause": {
    post: { summary: "Pause instance" },
  },
  "/api/v1/instance/resume": {
    post: { summary: "Resume instance" },
  },
  "/api/v1/notification-channels": {
    get: { summary: "Get notification channels" },
    put: { summary: "Update notification channels" },
  },
  "/api/v1/notification-channels/test": {
    post: { summary: "Send a test notification to a channel config" },
  },
  "/api/v1/backups": {
    get: { summary: "List backups" },
    post: { summary: "Create backup" },
  },
  "/api/v1/backups/verify": {
    post: { summary: "Verify backup archive" },
  },
  "/api/v1/queue": {
    get: { summary: "Admission queue snapshot" },
  },
  "/api/v1/filesystem": {
    get: { summary: "Browse host filesystem" },
  },
} as const;

/** OpenAPI document: registry-generated paths overlay the legacy hand-written base. */
export function buildOpenApiDocument(): {
  openapi: string;
  info: { title: string; version: string; description: string };
  paths: Record<string, unknown>;
} {
  const registryPaths = openApiPathsFromRegistry(getUseCaseRegistry());
  return {
    openapi: "3.0.3",
    info: {
      title: "Gojo API",
      version: "0.1.0",
      description: "Scheduled software-agent orchestration platform",
    },
    paths: mergeOpenApiPaths(
      legacyOpenApiPaths as unknown as Record<string, unknown>,
      registryPaths,
    ),
  };
}
