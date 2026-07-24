export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Gojo API",
    version: "0.1.0",
    description: "Scheduled software-agent orchestration platform",
  },
  paths: {
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
        ],
      },
      post: { summary: "Create project" },
    },
    "/api/v1/projects/{id}": {
      get: { summary: "Get project" },
      delete: { summary: "Remove project" },
    },
    "/api/v1/projects/{id}/sync": {
      post: { summary: "Sync project manifest" },
    },
    "/api/v1/projects/{id}/doctor": {
      get: { summary: "Project health checks" },
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
    "/api/v1/tasks/{id}/run": {
      post: { summary: "Queue task run" },
    },
    "/api/v1/schedules": {
      get: {
        summary: "List schedules",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
          { name: "projectId", in: "query", schema: { type: "string" } },
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
      get: { summary: "Dashboard summary" },
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
