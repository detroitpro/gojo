export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Gojo API",
    version: "0.1.0",
    description: "Scheduled software-agent orchestration platform",
  },
  paths: {
    "/api/v1/events": {
      get: {
        summary: "Stream durable platform change events",
        description:
          "Authenticated SSE stream with Last-Event-ID replay. Optional projectId and repeatable topic filters scope invalidation events.",
        parameters: [
          { name: "projectId", in: "query", schema: { type: "string" } },
          { name: "topic", in: "query", schema: { type: "string" } },
          { name: "after", in: "query", schema: { type: "integer", minimum: 0 } },
        ],
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
            schema: { type: "boolean" },
            description: "When true, only projects with currently-open gojo-tracked PRs",
          },
        ],
      },
      post: { summary: "Create project" },
    },
    "/api/v1/integrations": {
      get: {
        summary: "List gojo-tracked pull requests by status",
        description:
          "Rows from run_integrations with status=open|merged (not Impact’s date window). status is required.",
        parameters: [
          {
            name: "status",
            in: "query",
            required: true,
            schema: { type: "string", enum: ["open", "merged"] },
          },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
          { name: "projectId", in: "query", schema: { type: "string" } },
          { name: "sort", in: "query", schema: { type: "string" } },
          { name: "order", in: "query", schema: { type: "string" } },
        ],
      },
    },
    "/api/v1/projects/{id}": {
      get: { summary: "Get project" },
      delete: { summary: "Remove project" },
    },
    "/api/v1/projects/{id}/sync": {
      post: { summary: "Sync project manifest" },
    },
    "/api/v1/projects/{id}/doctor": {
      get: {
        summary: "Project health checks",
        description:
          "Includes baseCheckout (dirty files / behind origin) and validationTools resolved under the daemon PATH.",
      },
    },
    "/api/v1/projects/{id}/work": {
      get: {
        summary: "List project work",
        description:
          "Paged source-agnostic work ledger with execution, delivery, provenance, attention, and freshness filters.",
      },
    },
    "/api/v1/projects/{id}/work/status": {
      get: {
        summary: "Get project work status",
        description:
          "Canonical counts for working, queued, attention, verified-open, and stale-open work.",
      },
    },
    "/api/v1/projects/{id}/events": {
      get: {
        summary: "Stream project-scoped platform events",
        description:
          "Compatibility alias over the durable platform change stream, filtered to one project.",
      },
    },
    "/api/v1/projects/{id}/sources": {
      get: { summary: "List project source connections and health" },
      post: { summary: "Attach a source connection to a project" },
    },
    "/api/v1/projects/{id}/sources/{sourceId}/refresh": {
      post: { summary: "Enqueue or perform project source reconciliation" },
    },
    "/api/v1/work/{id}": {
      get: { summary: "Get work detail, links, events, and immutable run context" },
    },
    "/api/v1/work/{id}/recheck": {
      post: {
        summary: "Recheck a source-backed work item against its provider",
        description:
          "Verifies one work item by native identity. Confirmed merged/closed items leave attention and enter History; unverifiable items remain stale.",
      },
    },
    "/api/v1/work/{id}/resolve": {
      post: {
        summary: "Mark a work item resolved by an operator",
        description:
          "Clears attention without inventing a merged/closed delivery. The item remains in History and can reappear if the source later reports it active.",
      },
    },
    "/api/v1/sources/{sourceId}/events": {
      post: { summary: "Ingest a signed generic source work event" },
    },
    "/api/v1/agents": {
      get: { summary: "List and detect agents" },
    },
    "/api/v1/agents/{name}/test": {
      post: { summary: "Smoke-test agent adapter" },
    },
    "/api/v1/tasks": {
      get: {
        summary: "List tasks",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
          { name: "projectId", in: "query", schema: { type: "string" } },
          { name: "enabled", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
      },
      post: { summary: "Create task" },
    },
    "/api/v1/tasks/{id}": {
      get: { summary: "Get task detail (ops inspect + source paths)" },
    },
    "/api/v1/tasks/{id}/run": {
      post: { summary: "Queue task run" },
    },
    "/api/v1/tasks/{id}/enable": {
      post: { summary: "Enable task" },
    },
    "/api/v1/tasks/{id}/disable": {
      post: { summary: "Disable task" },
    },
    "/api/v1/schedules": {
      get: {
        summary: "List schedules",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
          { name: "projectId", in: "query", schema: { type: "string" } },
          { name: "taskId", in: "query", schema: { type: "string" } },
          { name: "enabled", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
      },
    },
    "/api/v1/schedules/upcoming": {
      get: {
        summary: "Upcoming schedule fire times within a horizon",
        parameters: [
          { name: "horizonHours", in: "query", schema: { type: "integer" } },
          { name: "projectId", in: "query", schema: { type: "string" } },
          { name: "enabled", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
      },
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
      get: {
        summary: "List runs",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
          { name: "projectId", in: "query", schema: { type: "string" } },
          { name: "taskId", in: "query", schema: { type: "string" } },
          { name: "state", in: "query", schema: { type: "string" } },
          { name: "trigger", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
      },
    },
    "/api/v1/runs/{id}": {
      get: { summary: "Get run" },
    },
    "/api/v1/runs/{id}/events": {
      get: { summary: "SSE run events" },
    },
    "/api/v1/runs/{id}/progress": {
      post: {
        summary: "Report structured run progress",
        description: "Accepts run-scoped agent tokens and updates canonical active-work focus.",
      },
    },
    "/api/v1/runs/{id}/diff": {
      get: { summary: "Changed files for run" },
    },
    "/api/v1/runs/{id}/artifacts": {
      get: { summary: "Run artifacts and handoff" },
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
    "/api/v1/dashboard": {
      get: { summary: "Dashboard summary counts" },
    },
    "/api/v1/dashboard/overview": {
      get: {
        summary: "Dashboard per-project task overview",
        description:
          "Projects with enabled tasks and up to five recent runs each (oldest to newest).",
      },
    },
    "/api/v1/dashboard/impact": {
      get: {
        summary: "Automation impact analytics",
        description:
          "Auditable impact accounting aggregated in SQL: merged automation runs, PR states, merge rate, impact counts by category and verification level (claimed/corroborated/verified), and recent impact items. Query params: projectId, from, to (ISO run creation bounds).",
      },
    },
    "/api/v1/instance": {
      get: { summary: "Instance settings" },
      patch: { summary: "Update instance settings" },
    },
    "/api/v1/instance/doctor": {
      get: {
        summary: "Instance diagnostics",
        description:
          "Includes daemonPath, tools (git/bun/gh/tea/sh), binaryStale/warnings when the daemon needs a restart after install.",
      },
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
      get: {
        summary: "List backups",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
      },
      post: { summary: "Create backup" },
    },
    "/api/v1/backups/verify": {
      post: { summary: "Verify backup archive" },
    },
  },
};
