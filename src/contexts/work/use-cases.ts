import { z } from "zod";

import { defineCommand, defineQuery } from "@/platform/registry";
import type { AppRuntime } from "@/platform/runtime";
import {
  WorkAttentionSchema,
  WorkDeliverySchema,
  WorkExecutionSchema,
  WorkOutcomeSchema,
  WorkProvenanceSchema,
  WorkStatusCompareWindowSchema,
} from "@shared/work";

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const integerFromInput = z
  .union([z.string(), z.number()])
  .transform((value) => {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : NaN;
  })
  .refine((value) => Number.isFinite(value), { message: "must be an integer" });

const boolFromInput = z.union([z.string(), z.boolean(), z.undefined(), z.null()])
  .transform((value) => value === "1" || value === "true" || value === true);

const nullableEnum = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .union([schema, z.null(), z.undefined()])
    .transform((value) => (value == null ? null : value));

const ProjectWorkListInputSchema = z.object({
  id: z.string().min(1),
  limit: integerFromInput.optional(),
  offset: integerFromInput.optional(),
  kind: optionalString.optional(),
  provenance: nullableEnum(WorkProvenanceSchema).optional(),
  delivery: nullableEnum(WorkDeliverySchema).optional(),
  attention: nullableEnum(WorkAttentionSchema).optional(),
  execution: nullableEnum(WorkExecutionSchema).optional(),
  outcome: nullableEnum(WorkOutcomeSchema).optional(),
  sourceId: optionalString.optional(),
  actor: optionalString.optional(),
  label: optionalString.optional(),
  from: optionalString.optional(),
  to: optionalString.optional(),
  q: optionalString.optional(),
  history: boolFromInput.optional(),
});

export const ListProjectWork = defineQuery<
  z.infer<typeof ProjectWorkListInputSchema>,
  unknown,
  AppRuntime
>({
  name: "work.projectItems.list",
  input: ProjectWorkListInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/projects/{id}/work" },
  async handle(input, runtime) {
    const { id, limit, offset, ...rest } = input;
    const page = await runtime.work.listProjectWork(id, {
      limit: limit ?? 20,
      offset: offset ?? 0,
      kind: rest.kind ?? null,
      provenance: rest.provenance ?? null,
      delivery: rest.delivery ?? null,
      attention: rest.attention ?? null,
      execution: rest.execution ?? null,
      outcome: rest.outcome ?? null,
      sourceId: rest.sourceId ?? null,
      actor: rest.actor ?? null,
      label: rest.label ?? null,
      from: rest.from ?? null,
      to: rest.to ?? null,
      q: rest.q ?? null,
      history: rest.history ?? false,
    });
    return { ok: true, value: page } as const;
  },
});

const ProjectWorkStatusInputSchema = z.object({
  id: z.string().min(1),
  compare: nullableEnum(WorkStatusCompareWindowSchema).optional(),
});

export const GetProjectWorkStatus = defineQuery<
  z.infer<typeof ProjectWorkStatusInputSchema>,
  unknown,
  AppRuntime
>({
  name: "work.projectStatus.get",
  input: ProjectWorkStatusInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/projects/{id}/work/status" },
  async handle(input, runtime) {
    const status = await runtime.work.getProjectStatus(input.id, {
      ...(input.compare ? { compareWindow: input.compare } : {}),
    });
    return { ok: true, value: status } as const;
  },
});

const ProjectIdInputSchema = z.object({ id: z.string().min(1) });

export const ListProjectSources = defineQuery<
  { id: string },
  unknown,
  AppRuntime
>({
  name: "work.projectSources.list",
  input: ProjectIdInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/projects/{id}/sources" },
  async handle(input, runtime) {
    const sources = await runtime.work.listProjectSources(input.id);
    return { ok: true, value: { sources } } as const;
  },
});

const CreateProjectSourceInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  adapter: z.string().min(1),
  baseUrl: z.union([z.string(), z.null()]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  kind: z.string().min(1),
  externalKey: z.string().min(1),
  displayName: z.union([z.string(), z.null()]).optional(),
  webUrl: z.union([z.string(), z.null()]).optional(),
});

export const CreateProjectSource = defineCommand<
  z.infer<typeof CreateProjectSourceInputSchema>,
  unknown,
  AppRuntime
>({
  name: "work.projectSource.create",
  input: CreateProjectSourceInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/projects/{id}/sources", successStatus: 201 },
  async handle(input, runtime) {
    const created = await runtime.work.createProjectSource({
      projectId: input.id,
      name: input.name,
      adapter: input.adapter,
      baseUrl: input.baseUrl ?? null,
      config: input.config ?? {},
      kind: input.kind,
      externalKey: input.externalKey,
      displayName: input.displayName ?? null,
      webUrl: input.webUrl ?? null,
    });
    return { ok: true, value: created } as const;
  },
});

const RefreshProjectSourceInputSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
});

export const RefreshProjectSource = defineCommand<
  z.infer<typeof RefreshProjectSourceInputSchema>,
  unknown,
  AppRuntime
>({
  name: "work.projectSource.refresh",
  input: RefreshProjectSourceInputSchema,
  output: z.any(),
  http: {
    method: "POST",
    path: "/api/v1/projects/{id}/sources/{sourceId}/refresh",
    successStatus: 202,
  },
  async handle(input, runtime) {
    const result = await runtime.work.refreshProjectSource({
      projectId: input.id,
      sourceId: input.sourceId,
    });
    return { ok: true, value: result } as const;
  },
});

const WorkItemIdInputSchema = z.object({ id: z.string().min(1) });

export const GetWorkItem = defineQuery<{ id: string }, unknown, AppRuntime>({
  name: "work.item.get",
  input: WorkItemIdInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/work/{id}" },
  async handle(input, runtime) {
    const detail = await runtime.work.getWorkItem(input.id);
    if (!detail) {
      const { useCaseFailure } = await import("@/platform/errors");
      return useCaseFailure("not_found", "Work item not found", 404);
    }
    return { ok: true, value: detail } as const;
  },
});

export const GetWorkItemDiff = defineQuery<{ id: string }, unknown, AppRuntime>({
  name: "work.item.diff.get",
  input: WorkItemIdInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/work/{id}/diff" },
  async handle(input, runtime) {
    const result = await runtime.work.getWorkItemDiff(input.id);
    return { ok: true, value: result } as const;
  },
});

export const RecheckWorkItem = defineCommand<{ id: string }, unknown, AppRuntime>({
  name: "work.item.recheck",
  input: WorkItemIdInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/work/{id}/recheck" },
  async handle(input, runtime) {
    const result = await runtime.work.recheckWorkItem(input.id);
    return { ok: true, value: result } as const;
  },
});

const ResolveWorkItemInputSchema = z.object({
  id: z.string().min(1),
  resolvedBy: z.union([z.string(), z.null()]).optional(),
  note: z.union([z.string(), z.null()]).optional(),
});

export const ResolveWorkItem = defineCommand<
  z.infer<typeof ResolveWorkItemInputSchema>,
  unknown,
  AppRuntime
>({
  name: "work.item.resolve",
  input: ResolveWorkItemInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/work/{id}/resolve" },
  async handle(input, runtime) {
    const actor = runtime.auth?.username ?? null;
    const result = await runtime.work.resolveWorkItem(input.id, {
      resolvedBy: input.resolvedBy ?? actor,
      note: input.note ?? null,
    });
    return { ok: true, value: result } as const;
  },
});

const IngestSourceWebhookInputSchema = z.object({
  sourceId: z.string().min(1),
  body: z.string(),
  signature: z.string(),
});

export const IngestSourceWebhook = defineCommand<
  z.infer<typeof IngestSourceWebhookInputSchema>,
  unknown,
  AppRuntime
>({
  name: "work.sources.ingestWebhook",
  input: IngestSourceWebhookInputSchema,
  output: z.any(),
  http: {
    method: "POST",
    path: "/api/v1/sources/{sourceId}/events",
    successStatus: 202,
    rawBody: true,
  },
  async handle(input, runtime) {
    try {
      const result = await runtime.work.ingestSourceWebhook(input);
      return { ok: true, value: result } as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const { useCaseFailure } = await import("@/platform/errors");
      return useCaseFailure("validation_error", message, 400);
    }
  },
});

const RebuildWorkStatusInputSchema = z.object({
  project: optionalString.optional(),
  projectId: optionalString.optional(),
  from: optionalString.optional(),
});

export const RebuildWorkStatus = defineCommand<
  z.infer<typeof RebuildWorkStatusInputSchema>,
  unknown,
  AppRuntime
>({
  name: "work.status.rebuild",
  input: RebuildWorkStatusInputSchema,
  output: z.any(),
  cli: { group: "work-status", command: "rebuild" },
  async handle(input, runtime) {
    const projectId = input.projectId ?? input.project ?? null;
    const result = await runtime.work.rebuildWorkStatus({
      projectId,
      from: input.from ?? null,
    });
    return { ok: true, value: result } as const;
  },
});

export const workUseCases = [
  ListProjectWork,
  GetProjectWorkStatus,
  ListProjectSources,
  CreateProjectSource,
  RefreshProjectSource,
  GetWorkItem,
  GetWorkItemDiff,
  RecheckWorkItem,
  ResolveWorkItem,
  IngestSourceWebhook,
  RebuildWorkStatus,
] as const;
