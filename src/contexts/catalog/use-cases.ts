import { z } from "zod";

import { defineCommand, defineQuery } from "@/platform/registry";
import type { AppRuntime } from "@/platform/runtime";

/** Queries with no meaningful input — ignore query/body shape. */
const EmptyInput = z.any().transform(() => ({}) as Record<string, never>);

/** Permissive list schemas — dispatch merges URL search params + JSON body. */
const ListProjectsInputSchema = z
  .object({
    limit: z.union([z.string(), z.number()]).optional().nullable(),
    offset: z.union([z.string(), z.number()]).optional().nullable(),
    sort: z.string().optional().nullable(),
    order: z.string().optional().nullable(),
    q: z.string().optional().nullable(),
    hasOpenPrs: z.union([z.string(), z.boolean()]).optional().nullable(),
  })
  .passthrough();

const IdInputSchema = z.object({ id: z.string().min(1) }).passthrough();

const ListAgentsInputSchema = z
  .object({
    limit: z.union([z.string(), z.number()]).optional().nullable(),
    offset: z.union([z.string(), z.number()]).optional().nullable(),
    sort: z.string().optional().nullable(),
    order: z.string().optional().nullable(),
    projectId: z.string().optional().nullable(),
    enabled: z.string().optional().nullable(),
    q: z.string().optional().nullable(),
  })
  .passthrough();

const ListSchedulesInputSchema = z
  .object({
    limit: z.union([z.string(), z.number()]).optional().nullable(),
    offset: z.union([z.string(), z.number()]).optional().nullable(),
    sort: z.string().optional().nullable(),
    order: z.string().optional().nullable(),
    projectId: z.string().optional().nullable(),
    agentId: z.string().optional().nullable(),
    enabled: z.string().optional().nullable(),
    q: z.string().optional().nullable(),
  })
  .passthrough();

const ListImpactItemsInputSchema = z
  .object({
    limit: z.union([z.string(), z.number()]).optional().nullable(),
    offset: z.union([z.string(), z.number()]).optional().nullable(),
    sort: z.string().optional().nullable(),
    order: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    projectId: z.string().optional().nullable(),
    from: z.string().optional().nullable(),
    to: z.string().optional().nullable(),
  })
  .passthrough();

const BrowseFilesystemInputSchema = z
  .object({ path: z.string().optional().nullable() })
  .passthrough();

const TestAdapterInputSchema = z
  .object({ name: z.string().min(1) })
  .passthrough();

// -------- Projects --------

export const ListProjects = defineQuery<
  z.infer<typeof ListProjectsInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.projects.list",
  input: ListProjectsInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/projects" },
  cli: { group: "project", command: "list" },
  async handle(input, runtime) {
    return runtime.catalog.listProjects(input);
  },
});

export const GetProject = defineQuery<
  z.infer<typeof IdInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.projects.get",
  input: IdInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/projects/{id}" },
  async handle(input, runtime) {
    return runtime.catalog.getProject({ id: input.id });
  },
});

export const DeleteProject = defineCommand<
  z.infer<typeof IdInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.projects.delete",
  input: IdInputSchema,
  output: z.any(),
  http: { method: "DELETE", path: "/api/v1/projects/{id}" },
  async handle(input, runtime) {
    const result = await runtime.catalog.deleteProject({ id: input.id });
    if (!result.ok) return result;
    return { ok: true as const, value: { removed: result.value.removed } };
  },
});

export const SyncProject = defineCommand<
  z.infer<typeof IdInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.projects.sync",
  input: IdInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/projects/{id}/sync" },
  cli: { group: "project", command: "sync" },
  async handle(input, runtime) {
    const result = await runtime.catalog.syncProject({ projectId: input.id });
    if (!result.ok) return result;
    return {
      ok: true as const,
      value: { project: result.value.project, sync: result.value.sync },
    };
  },
});

// -------- Agents --------

export const ListAgents = defineQuery<
  z.infer<typeof ListAgentsInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.agents.list",
  input: ListAgentsInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/agents" },
  cli: { group: "agent", command: "list" },
  async handle(input, runtime) {
    return runtime.catalog.listAgents(input);
  },
});

export const GetAgent = defineQuery<
  z.infer<typeof IdInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.agents.get",
  input: IdInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/agents/{id}" },
  async handle(input, runtime) {
    return runtime.catalog.getAgent({ id: input.id });
  },
});

export const EnableAgent = defineCommand<
  z.infer<typeof IdInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.agents.enable",
  input: IdInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/agents/{id}/enable" },
  cli: { group: "agent", command: "enable" },
  async handle(input, runtime) {
    const result = await runtime.catalog.setAgentEnabled({
      id: input.id,
      enabled: true,
    });
    if (!result.ok) return result;
    return { ok: true as const, value: { agent: result.value.agent } };
  },
});

export const DisableAgent = defineCommand<
  z.infer<typeof IdInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.agents.disable",
  input: IdInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/agents/{id}/disable" },
  cli: { group: "agent", command: "disable" },
  async handle(input, runtime) {
    const result = await runtime.catalog.setAgentEnabled({
      id: input.id,
      enabled: false,
    });
    if (!result.ok) return result;
    return { ok: true as const, value: { agent: result.value.agent } };
  },
});

// -------- Schedules --------

export const ListSchedules = defineQuery<
  z.infer<typeof ListSchedulesInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.schedules.list",
  input: ListSchedulesInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/schedules" },
  async handle(input, runtime) {
    return runtime.catalog.listSchedules(input);
  },
});

export const EnableSchedule = defineCommand<
  z.infer<typeof IdInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.schedules.enable",
  input: IdInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/schedules/{id}/enable" },
  cli: { group: "schedule", command: "enable" },
  async handle(input, runtime) {
    const result = await runtime.catalog.setScheduleEnabled({
      id: input.id,
      enabled: true,
    });
    if (!result.ok) return result;
    return { ok: true as const, value: { schedule: result.value.schedule } };
  },
});

export const DisableSchedule = defineCommand<
  z.infer<typeof IdInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.schedules.disable",
  input: IdInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/schedules/{id}/disable" },
  cli: { group: "schedule", command: "disable" },
  async handle(input, runtime) {
    const result = await runtime.catalog.setScheduleEnabled({
      id: input.id,
      enabled: false,
    });
    if (!result.ok) return result;
    return { ok: true as const, value: { schedule: result.value.schedule } };
  },
});

export const PauseSchedule = defineCommand<
  z.infer<typeof IdInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.schedules.pause",
  input: IdInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/schedules/{id}/pause" },
  cli: { group: "schedule", command: "pause" },
  async handle(input, runtime) {
    const result = await runtime.catalog.setScheduleEnabled({
      id: input.id,
      enabled: false,
    });
    if (!result.ok) return result;
    return { ok: true as const, value: { schedule: result.value.schedule } };
  },
});

// -------- Adapters --------

export const ListAdapters = defineQuery<
  Record<string, never>,
  unknown,
  AppRuntime
>({
  name: "catalog.adapters.list",
  input: EmptyInput,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/adapters" },
  async handle(_input, runtime) {
    return runtime.catalog.listAdapters();
  },
});

export const TestAdapter = defineCommand<
  z.infer<typeof TestAdapterInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.adapters.test",
  input: TestAdapterInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/adapters/{name}/test" },
  async handle(input, runtime) {
    return runtime.catalog.testAdapter({ name: input.name });
  },
});

// -------- Filesystem --------

export const BrowseFilesystem = defineQuery<
  z.infer<typeof BrowseFilesystemInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.filesystem.browse",
  input: BrowseFilesystemInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/filesystem" },
  async handle(input, runtime) {
    return runtime.catalog.browseFilesystem({ path: input.path ?? null });
  },
});

// -------- Impact items --------

export const ListImpactItems = defineQuery<
  z.infer<typeof ListImpactItemsInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.impact.items.list",
  input: ListImpactItemsInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/impact/items" },
  async handle(input, runtime) {
    return runtime.catalog.listImpactItems(input);
  },
});

const CreateProjectInputSchema = z
  .object({
    name: z.string().min(1),
    repoPath: z.string().min(1),
    defaultBranch: z.string().optional(),
    remoteUrl: z.string().optional(),
  })
  .passthrough();

export const CreateProject = defineCommand<
  z.infer<typeof CreateProjectInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.projects.create",
  input: CreateProjectInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/projects", successStatus: 201 },
  async handle(input, runtime) {
    const { createProjectCommand } = await import("./application/create-project");
    const createInput: {
      name: string;
      repoPath: string;
      defaultBranch?: string;
      remoteUrl?: string;
    } = {
      name: input.name,
      repoPath: input.repoPath,
    };
    if (input.defaultBranch !== undefined) {
      createInput.defaultBranch = input.defaultBranch;
    }
    if (input.remoteUrl !== undefined) {
      createInput.remoteUrl = input.remoteUrl;
    }
    return createProjectCommand(
      {
        createProject: (data) => runtime.ctx.repos.projects.create(data),
        toProjectDetail: (project) => runtime.catalog.store.toProjectDetail(project),
        ensureProjectRepositorySource: (projectId) =>
          runtime.catalog.store.ensureProjectRepositorySource(projectId),
        appendEvent: (event) => runtime.ctx.platformEvents.append(event),
      },
      createInput,
    );
  },
});

export const GetProjectDoctor = defineQuery<{ id: string }, unknown, AppRuntime>({
  name: "catalog.projects.doctor",
  input: IdInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/projects/{id}/doctor" },
  cli: { group: "project", command: "doctor" },
  async handle(input, runtime) {
    const { useCaseFailure } = await import("@/platform/errors");
    const project = runtime.catalog.store.findProject(input.id);
    if (!project) return useCaseFailure("not_found", "Project not found", 404);
    const { projectDoctor } = await import("@/contexts/operations/infrastructure/diagnostics/doctor");
    return { ok: true, value: await projectDoctor(project, runtime.ctx.repos) };
  },
});

const CreateAgentInputSchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    prompt: z.string().min(1),
    description: z.string().optional(),
    profileId: z.string().nullable().optional(),
    validationProfileJson: z.string().optional(),
    integrationJson: z.string().optional(),
    failurePolicyJson: z.string().optional(),
    concurrencyJson: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough();

export const CreateAgent = defineCommand<
  z.infer<typeof CreateAgentInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.agents.create",
  input: CreateAgentInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/agents", successStatus: 201 },
  async handle(input, runtime) {
    const { useCaseFailure } = await import("@/platform/errors");
    const project = runtime.catalog.store.findProject(input.projectId);
    if (!project) return useCaseFailure("not_found", "Project not found", 404);
    const agent = runtime.ctx.repos.agents.create({
      projectId: input.projectId,
      name: input.name,
      prompt: input.prompt,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
      ...(input.validationProfileJson !== undefined
        ? { validationProfileJson: input.validationProfileJson }
        : {}),
      ...(input.integrationJson !== undefined
        ? { integrationJson: input.integrationJson }
        : {}),
      ...(input.failurePolicyJson !== undefined
        ? { failurePolicyJson: input.failurePolicyJson }
        : {}),
      ...(input.concurrencyJson !== undefined
        ? { concurrencyJson: input.concurrencyJson }
        : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    runtime.ctx.platformEvents.append({
      projectId: agent.projectId,
      type: "agent.created",
      entityKind: "agent",
      entityId: agent.id,
      topics: ["dashboard", "overview", "projects", "agents"],
    });
    return { ok: true, value: { agent } };
  },
});

const UpcomingSchedulesInputSchema = z
  .object({
    horizonHours: z.union([z.string(), z.number()]).optional().nullable(),
    projectId: z.string().optional().nullable(),
    enabled: z.string().optional().nullable(),
    q: z.string().optional().nullable(),
  })
  .passthrough();

export const ListUpcomingSchedules = defineQuery<
  z.infer<typeof UpcomingSchedulesInputSchema>,
  unknown,
  AppRuntime
>({
  name: "catalog.schedules.upcoming",
  input: UpcomingSchedulesInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/schedules/upcoming" },
  cli: { group: "schedule", command: "next" },
  async handle(input, runtime) {
    const { listUpcomingSchedules } = await import(
      "@/contexts/scheduling/application/upcoming"
    );
    const { listSchedulesPage } = await import(
      "@/contexts/catalog/infrastructure/catalog-paged-lists"
    );
    const horizonRaw = Number(input.horizonHours ?? "168");
    const enabledRaw = input.enabled ?? null;
    let enabled: boolean | null = null;
    if (enabledRaw === "true" || enabledRaw === "1" || enabledRaw === "enabled") {
      enabled = true;
    } else if (
      enabledRaw === "false" ||
      enabledRaw === "0" ||
      enabledRaw === "disabled"
    ) {
      enabled = false;
    }
    return {
      ok: true,
      value: listUpcomingSchedules(
        {
          listSchedules: (query) =>
            listSchedulesPage(runtime.ctx.db, query),
        },
        {
          horizonHours: horizonRaw,
          projectId: input.projectId ?? null,
          enabled,
          q: input.q ?? null,
        },
      ),
    };
  },
});

export const catalogUseCases = [
  ListProjects,
  GetProject,
  CreateProject,
  DeleteProject,
  SyncProject,
  GetProjectDoctor,
  ListAgents,
  GetAgent,
  CreateAgent,
  EnableAgent,
  DisableAgent,
  ListSchedules,
  ListUpcomingSchedules,
  EnableSchedule,
  DisableSchedule,
  PauseSchedule,
  ListAdapters,
  TestAdapter,
  BrowseFilesystem,
  ListImpactItems,
] as const;
