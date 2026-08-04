import { z } from "zod";

import { useCaseFailure } from "@/platform/errors";
import { defineCommand, defineQuery } from "@/platform/registry";
import type { AppRuntime } from "@/platform/runtime";

const RunIdInput = z.object({ runId: z.string().min(1) });

const OrderSchema = z.enum(["asc", "desc"]);

const RunListInput = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
  sort: z.string().default("createdAt"),
  order: OrderSchema.default("desc"),
  projectId: z.string().nullish(),
  agentId: z.string().nullish(),
  state: z.string().nullish(),
  trigger: z.string().nullish(),
  q: z.string().nullish(),
  from: z.string().nullish(),
  to: z.string().nullish(),
});

const RunPageOutput = z.object({
  runs: z.array(z.any()),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

const RunDetailOutput = z.object({
  run: z.any(),
  attempts: z.array(z.any()),
  impactItems: z.array(z.any()),
  integration: z.any().nullable(),
  approval: z.any().nullable(),
});

const RunOutput = z.object({ run: z.any() });

const ProgressInput = z.object({
  runId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  blockedReason: z.string().nullish().default(null),
  references: z.array(z.string()).default([]),
});

export const ListRuns = defineQuery<
  z.infer<typeof RunListInput>,
  z.infer<typeof RunPageOutput>,
  AppRuntime
>({
  name: "execution.run.list",
  input: RunListInput,
  output: RunPageOutput,
  http: { method: "GET", path: "/api/v1/runs" },
  cli: { group: "run", command: "list" },
  async handle(input, runtime) {
    const result = await runtime.execution.listRuns({
      limit: input.limit,
      offset: input.offset,
      sort: input.sort,
      order: input.order,
      projectId: input.projectId ?? null,
      agentId: input.agentId ?? null,
      state: input.state ?? null,
      trigger: input.trigger ?? null,
      q: input.q ?? null,
      from: input.from ?? null,
      to: input.to ?? null,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      value: {
        runs: result.value.items,
        total: result.value.total,
        limit: result.value.limit,
        offset: result.value.offset,
      },
    };
  },
});

export const GetRun = defineQuery<
  { runId: string },
  z.infer<typeof RunDetailOutput>,
  AppRuntime
>({
  name: "execution.run.get",
  input: RunIdInput,
  output: RunDetailOutput,
  http: { method: "GET", path: "/api/v1/runs/{runId}" },
  cli: { group: "run", command: "inspect" },
  async handle(input, runtime) {
    const result = await runtime.execution.getRun(input.runId);
    if (result.ok) return result;
    return useCaseFailure("not_found", String(result.error), 404);
  },
});

const RunArtifactsOutput = z.object({
  path: z.string(),
  exists: z.boolean(),
  handoff: z.any().nullable(),
  validation: z.any().nullable(),
  failure: z.any().nullable(),
});

export const GetRunArtifacts = defineQuery<
  { runId: string },
  z.infer<typeof RunArtifactsOutput>,
  AppRuntime
>({
  name: "execution.run.artifacts",
  input: RunIdInput,
  output: RunArtifactsOutput,
  http: { method: "GET", path: "/api/v1/runs/{runId}/artifacts" },
  cli: { group: "run", command: "artifacts" },
  async handle(input, runtime) {
    return runtime.execution.getArtifacts(input.runId);
  },
});

export const GetRunDiff = defineQuery<
  { runId: string },
  { files: string[] },
  AppRuntime
>({
  name: "execution.run.diff",
  input: RunIdInput,
  output: z.object({ files: z.array(z.string()) }),
  http: { method: "GET", path: "/api/v1/runs/{runId}/diff" },
  cli: { group: "run", command: "diff" },
  async handle(input, runtime) {
    return runtime.execution.getDiff(input.runId);
  },
});

export const CancelRun = defineCommand<
  { runId: string },
  z.infer<typeof RunOutput>,
  AppRuntime
>({
  name: "execution.run.cancel",
  input: RunIdInput,
  output: RunOutput,
  http: { method: "POST", path: "/api/v1/runs/{runId}/cancel" },
  async handle(input, runtime) {
    const result = await runtime.execution.cancelRun(input.runId);
    if (!result.ok) return result;
    const detail = runtime.execution.reads.detail(input.runId);
    return { ok: true, value: { run: detail?.run ?? { id: input.runId, state: result.value.state } } };
  },
});

export const ApproveRun = defineCommand<
  { runId: string },
  z.infer<typeof RunOutput>,
  AppRuntime
>({
  name: "execution.run.approve",
  input: RunIdInput,
  output: RunOutput,
  http: { method: "POST", path: "/api/v1/runs/{runId}/approve" },
  cli: { group: "run", command: "approve" },
  async handle(input, runtime) {
    const result = await runtime.execution.approveRun(input.runId);
    if (!result.ok) return result;
    const detail = runtime.execution.reads.detail(input.runId);
    return { ok: true, value: { run: detail?.run ?? { id: input.runId, state: result.value.state } } };
  },
});

export const RejectRun = defineCommand<
  { runId: string; reason?: string | null },
  z.infer<typeof RunOutput>,
  AppRuntime
>({
  name: "execution.run.reject",
  input: RunIdInput.extend({ reason: z.string().nullish() }),
  output: RunOutput,
  http: { method: "POST", path: "/api/v1/runs/{runId}/reject" },
  cli: { group: "run", command: "reject" },
  async handle(input, runtime) {
    const result = await runtime.execution.rejectRun(input.runId, input.reason ?? null);
    if (!result.ok) return result;
    const detail = runtime.execution.reads.detail(input.runId);
    return { ok: true, value: { run: detail?.run ?? { id: input.runId, state: result.value.state } } };
  },
});

export const RetryRun = defineCommand<
  { runId: string },
  z.infer<typeof RunOutput>,
  AppRuntime
>({
  name: "execution.run.retry",
  input: RunIdInput,
  output: RunOutput,
  http: { method: "POST", path: "/api/v1/runs/{runId}/retry", successStatus: 202 },
  async handle(input, runtime) {
    const result = await runtime.execution.retryRun(input.runId);
    if (!result.ok) return result;
    runtime.kickDispatcher();
    return { ok: true, value: { run: result.value.run } };
  },
});

export const RunProgress = defineCommand<
  z.infer<typeof ProgressInput>,
  z.infer<typeof RunOutput>,
  AppRuntime
>({
  name: "execution.run.progress",
  input: ProgressInput,
  output: RunOutput,
  http: { method: "POST", path: "/api/v1/runs/{runId}/progress" },
  async handle(input, runtime) {
    const result = await runtime.execution.updateProgress(input.runId, {
      title: input.title,
      summary: input.summary,
      blockedReason: input.blockedReason ?? null,
      references: input.references,
    });
    if (!result.ok) return result;
    const detail = runtime.execution.reads.detail(input.runId);
    return { ok: true, value: { run: detail?.run ?? { id: input.runId, state: result.value.state } } };
  },
});

export const EnqueueAgentRun = defineCommand<
  { id: string },
  unknown,
  AppRuntime
>({
  name: "execution.agent.run",
  input: z.object({ id: z.string().min(1) }).passthrough(),
  output: z.any(),
  http: { method: "POST", path: "/api/v1/agents/{id}/run", successStatus: 202 },
  cli: { group: "agent", command: "run" },
  async handle(input, runtime) {
    const agent = runtime.ctx.repos.agents.findById(input.id);
    if (!agent) return useCaseFailure("not_found", "Agent not found", 404);
    if (!agent.enabled) {
      return useCaseFailure("conflict", "Agent is disabled", 409);
    }
    const project = runtime.ctx.repos.projects.findById(agent.projectId);
    if (!project) return useCaseFailure("not_found", "Project not found", 404);
    if (!project.enabled) {
      return useCaseFailure("conflict", "Project is disabled", 409);
    }
    const run = await runtime.ctx.coordinator.enqueueRun({
      projectId: agent.projectId,
      agentId: agent.id,
      trigger: "api",
    });
    runtime.kickDispatcher();
    return { ok: true, value: { run } };
  },
});

export const executionUseCases = [
  ListRuns,
  GetRun,
  GetRunArtifacts,
  GetRunDiff,
  CancelRun,
  ApproveRun,
  RejectRun,
  RetryRun,
  RunProgress,
  EnqueueAgentRun,
] as const;
