import { z } from "zod";

import { defineCommand, defineQuery } from "@/platform/registry";
import type { AppRuntime } from "@/platform/runtime";
import { QUEUE_SORT_ALLOWED } from "@shared/list-api";

const EmptyInput = z.any().transform(() => ({} as Record<string, never>));

const HealthOutput = z.object({
  status: z.literal("ok"),
  paused: z.boolean(),
  version: z.string(),
});

export const Health = defineQuery<
  Record<string, never>,
  z.infer<typeof HealthOutput>,
  AppRuntime
>({
  name: "operations.health",
  input: EmptyInput,
  output: HealthOutput,
  http: { method: "GET", path: "/api/v1/health" },
  async handle(_input, runtime) {
    return runtime.operations.health();
  },
});

const InstanceView = z.object({
  bindHost: z.string(),
  bindPort: z.number().int(),
  publicBaseUrl: z.string().nullable(),
  trustedProxies: z.array(z.string()),
  allowedOrigins: z.array(z.string()),
  ipAllowlist: z.array(z.string()),
  cookieSecure: z.enum(["auto", "always", "never"]),
  paused: z.boolean(),
  telemetryEnabled: z.boolean(),
  apiBaseUrl: z.string().nullable(),
  restartRequired: z.boolean(),
});

export const GetInstance = defineQuery<
  Record<string, never>,
  z.infer<typeof InstanceView>,
  AppRuntime
>({
  name: "operations.instance.get",
  input: EmptyInput,
  output: InstanceView,
  http: { method: "GET", path: "/api/v1/instance" },
  cli: { group: "instance", command: "show" },
  async handle(_input, runtime) {
    return runtime.operations.getInstance();
  },
});

const InstancePatchInput = z.object({
  bindHost: z.string().optional(),
  bindPort: z.number().int().optional(),
  publicBaseUrl: z.union([z.string(), z.null()]).optional(),
  trustedProxies: z.array(z.string()).optional(),
  allowedOrigins: z.array(z.string()).optional(),
  ipAllowlist: z.array(z.string()).optional(),
  cookieSecure: z.enum(["auto", "always", "never"]).optional(),
  telemetryEnabled: z.boolean().optional(),
});

export const UpdateInstance = defineCommand<
  z.infer<typeof InstancePatchInput>,
  z.infer<typeof InstanceView>,
  AppRuntime
>({
  name: "operations.instance.update",
  input: InstancePatchInput,
  output: InstanceView,
  http: { method: "PATCH", path: "/api/v1/instance" },
  async handle(input, runtime) {
    const patch: Parameters<typeof runtime.operations.updateInstance>[0] = {};
    if (input.bindHost !== undefined) patch.bindHost = input.bindHost;
    if (input.bindPort !== undefined) patch.bindPort = input.bindPort;
    if (input.publicBaseUrl !== undefined) patch.publicBaseUrl = input.publicBaseUrl;
    if (input.trustedProxies !== undefined) patch.trustedProxies = input.trustedProxies;
    if (input.allowedOrigins !== undefined) patch.allowedOrigins = input.allowedOrigins;
    if (input.ipAllowlist !== undefined) patch.ipAllowlist = input.ipAllowlist;
    if (input.cookieSecure !== undefined) patch.cookieSecure = input.cookieSecure;
    if (input.telemetryEnabled !== undefined) patch.telemetryEnabled = input.telemetryEnabled;
    return runtime.operations.updateInstance(patch);
  },
});

export const PauseInstance = defineCommand<
  Record<string, never>,
  { paused: boolean },
  AppRuntime
>({
  name: "operations.instance.pause",
  input: EmptyInput,
  output: z.object({ paused: z.boolean() }),
  http: { method: "POST", path: "/api/v1/instance/pause" },
  cli: { group: "instance", command: "pause" },
  async handle(_input, runtime) {
    return runtime.operations.pauseInstance();
  },
});

export const ResumeInstance = defineCommand<
  Record<string, never>,
  { paused: boolean },
  AppRuntime
>({
  name: "operations.instance.resume",
  input: EmptyInput,
  output: z.object({ paused: z.boolean() }),
  http: { method: "POST", path: "/api/v1/instance/resume" },
  cli: { group: "instance", command: "resume" },
  async handle(_input, runtime) {
    return runtime.operations.resumeInstance();
  },
});

export const InstanceDoctor = defineQuery<
  Record<string, never>,
  unknown,
  AppRuntime
>({
  name: "operations.instance.doctor",
  input: EmptyInput,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/instance/doctor" },
  async handle(_input, runtime) {
    return runtime.operations.instanceDoctor();
  },
});

const BackupListOutput = z.object({
  backups: z.array(z.any()),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

const BackupListInput = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
  q: z.string().nullish(),
});

export const ListBackups = defineQuery<
  z.infer<typeof BackupListInput>,
  z.infer<typeof BackupListOutput>,
  AppRuntime
>({
  name: "operations.backups.list",
  input: BackupListInput,
  output: BackupListOutput,
  http: { method: "GET", path: "/api/v1/backups" },
  async handle(input, runtime) {
    const result = await runtime.operations.listBackups();
    if (!result.ok) return result;
    const q = input.q?.trim().toLowerCase() ?? "";
    const filtered = q
      ? result.value.filter(
          (backup) =>
            backup.name.toLowerCase().includes(q) ||
            backup.path.toLowerCase().includes(q),
        )
      : result.value;
    return {
      ok: true,
      value: {
        backups: filtered.slice(input.offset, input.offset + input.limit),
        total: filtered.length,
        limit: input.limit,
        offset: input.offset,
      },
    };
  },
});

export const CreateBackup = defineCommand<
  Record<string, never>,
  unknown,
  AppRuntime
>({
  name: "operations.backups.create",
  input: EmptyInput,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/backups", successStatus: 201 },
  async handle(_input, runtime) {
    return runtime.operations.createBackup();
  },
});

const BackupVerifyInput = z.object({ path: z.string().min(1) });

export const VerifyBackup = defineCommand<
  { path: string },
  { path: string; valid: boolean },
  AppRuntime
>({
  name: "operations.backups.verify",
  input: BackupVerifyInput,
  output: z.object({ path: z.string(), valid: z.boolean() }),
  http: { method: "POST", path: "/api/v1/backups/verify" },
  async handle(input, runtime) {
    return runtime.operations.verifyBackup(input.path);
  },
});

const DashboardSummaryInput = z.object({ compare: z.string().nullish() });

export const DashboardSummary = defineQuery<
  { compare?: string | null },
  unknown,
  AppRuntime
>({
  name: "operations.dashboard.summary",
  input: DashboardSummaryInput,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/dashboard" },
  async handle(input, runtime) {
    return runtime.operations.dashboardSummary(input.compare ?? "");
  },
});

export const DashboardOverview = defineQuery<
  Record<string, never>,
  unknown,
  AppRuntime
>({
  name: "operations.dashboard.overview",
  input: EmptyInput,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/dashboard/overview" },
  async handle(_input, runtime) {
    return runtime.operations.dashboardOverview();
  },
});

const DashboardImpactInput = z.object({
  projectId: z.string().nullish(),
  from: z.string().nullish(),
  to: z.string().nullish(),
  range: z.string().nullish(),
});

export const DashboardImpact = defineQuery<
  z.infer<typeof DashboardImpactInput>,
  unknown,
  AppRuntime
>({
  name: "operations.dashboard.impact",
  input: DashboardImpactInput,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/dashboard/impact" },
  async handle(input, runtime) {
    return runtime.operations.dashboardImpact({
      projectId: input.projectId ?? null,
      from: input.from ?? null,
      to: input.to ?? null,
      range: input.range ?? null,
    });
  },
});

const QueueSortAllowed = z.enum(QUEUE_SORT_ALLOWED as unknown as readonly [string, ...string[]]);
const QueueInput = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
  sort: QueueSortAllowed.default("position"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

export const QueueSnapshot = defineQuery<
  z.infer<typeof QueueInput>,
  unknown,
  AppRuntime
>({
  name: "operations.queue.snapshot",
  input: QueueInput,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/queue" },
  async handle(input, runtime) {
    return runtime.operations.queueSnapshot(input);
  },
});

const WorktreeSweepOutput = z.object({
  scanned: z.number(),
  removed: z.array(z.string()),
  keptLive: z.array(z.string()),
  errors: z.array(z.object({ path: z.string(), error: z.string() })),
});

export const SweepWorktrees = defineCommand<
  Record<string, never>,
  z.infer<typeof WorktreeSweepOutput>,
  AppRuntime
>({
  name: "operations.worktrees.sweep",
  input: EmptyInput,
  output: WorktreeSweepOutput,
  http: { method: "POST", path: "/api/v1/worktrees/sweep" },
  cli: { group: "instance", command: "sweep-worktrees" },
  async handle(_input, runtime) {
    return runtime.operations.sweepWorktrees();
  },
});

export const operationsUseCases = [
  Health,
  GetInstance,
  UpdateInstance,
  PauseInstance,
  ResumeInstance,
  InstanceDoctor,
  SweepWorktrees,
  ListBackups,
  CreateBackup,
  VerifyBackup,
  DashboardSummary,
  DashboardOverview,
  DashboardImpact,
  QueueSnapshot,
] as const;
