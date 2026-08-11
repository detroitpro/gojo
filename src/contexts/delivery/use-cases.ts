import { z } from "zod";

import { useCaseFailure } from "@/platform/errors";
import { defineCommand, defineQuery } from "@/platform/registry";
import type { AppRuntime } from "@/platform/runtime";
import { ApprovalAutonomySchema, ApprovalStateSchema } from "@shared/approvals";

const optionalString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const integerFromInput = z
  .union([z.string(), z.number(), z.undefined(), z.null()])
  .transform((value) => {
    if (value == null || value === "") return undefined;
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  });

const ApprovalStateInput = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value == null || value === "") return null;
    const parsed = ApprovalStateSchema.safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid approval state",
      });
      return z.NEVER;
    }
    return parsed.data;
  });

const ListApprovalsInputSchema = z.object({
  limit: integerFromInput.optional(),
  offset: integerFromInput.optional(),
  projectId: optionalString.optional(),
  subjectType: optionalString.optional(),
  state: ApprovalStateInput.optional(),
});

export const ListApprovals = defineQuery<
  z.infer<typeof ListApprovalsInputSchema>,
  unknown,
  AppRuntime
>({
  name: "delivery.approvals.list",
  input: ListApprovalsInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/approvals" },
  cli: { group: "approval", command: "list" },
  async handle(input, runtime) {
    const page = await runtime.delivery.listApprovals({
      limit: input.limit ?? 20,
      offset: input.offset ?? 0,
      projectId: input.projectId ?? null,
      subjectType: input.subjectType ?? null,
      state: input.state ?? null,
    });
    return {
      ok: true,
      value: {
        approvals: page.items,
        total: page.total,
        limit: page.limit,
        offset: page.offset,
      },
    } as const;
  },
});

const ApprovalIdInputSchema = z.object({ id: z.string().min(1) });

export const GetApproval = defineQuery<{ id: string }, unknown, AppRuntime>({
  name: "delivery.approval.get",
  input: ApprovalIdInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/approvals/{id}" },
  cli: { group: "approval", command: "show" },
  async handle(input, runtime) {
    const approval = await runtime.delivery.getApproval(input.id);
    if (!approval) {
      return useCaseFailure("not_found", "Approval not found", 404);
    }
    return { ok: true, value: { approval } } as const;
  },
});

function makeApprovalActionCommand(
  action: "approve" | "reject" | "hold",
  cliCommand: string,
) {
  const InputSchema = z.object({
    id: z.string().min(1),
    note: z.union([z.string(), z.null()]).optional(),
    surfaceRef: z.union([z.string(), z.null()]).optional(),
  });
  return defineCommand<z.infer<typeof InputSchema>, unknown, AppRuntime>({
    name: `delivery.approval.${action}`,
    input: InputSchema,
    output: z.any(),
    http: { method: "POST", path: `/api/v1/approvals/{id}/${action}` },
    cli: { group: "approval", command: cliCommand },
    async handle(input, runtime) {
      const auth = runtime.auth;
      if (!auth) {
        return useCaseFailure("unauthorized", "Authentication required", 401);
      }
      const revokeAfterApprove =
        action === "approve" &&
        auth.authMethod === "token" &&
        auth.tokenId &&
        auth.scopes?.includes(`control:approve:${input.id}`)
          ? { userId: auth.userId, tokenId: auth.tokenId }
          : null;
      const result = await runtime.delivery.submitApprovalIntent({
        approvalId: input.id,
        action,
        actor: auth.username,
        surface: "api",
        surfaceRef: input.surfaceRef ?? auth.tokenId ?? null,
        note: input.note ?? null,
        revokeAfterApprove,
      });
      if (result.ok) {
        return {
          ok: true,
          value: { intent: result.intent, approval: result.approval },
        } as const;
      }
      return useCaseFailure(
        result.code,
        result.message,
        result.code === "not_found" ? 404 : 409,
      );
    },
  });
}

export const ApproveApproval = makeApprovalActionCommand("approve", "approve");
export const RejectApproval = makeApprovalActionCommand("reject", "reject");
export const HoldApproval = makeApprovalActionCommand("hold", "hold");

const SetApprovalAutonomyInputSchema = z.object({
  id: z.string().min(1),
  autonomy: z.string().min(1),
});

export const SetApprovalAutonomy = defineCommand<
  z.infer<typeof SetApprovalAutonomyInputSchema>,
  unknown,
  AppRuntime
>({
  name: "delivery.approval.setAutonomy",
  input: SetApprovalAutonomyInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/approvals/{id}/autonomy" },
  cli: { group: "approval", command: "set-autonomy" },
  async handle(input, runtime) {
    if (!runtime.auth) {
      return useCaseFailure("unauthorized", "Authentication required", 401);
    }
    const parsed = ApprovalAutonomySchema.safeParse(input.autonomy);
    if (!parsed.success) {
      return useCaseFailure(
        "validation_error",
        "autonomy must be manual, reviewer, or auto",
        400,
      );
    }
    try {
      const approval = await runtime.delivery.setApprovalAutonomy(
        input.id,
        parsed.data,
      );
      return { ok: true, value: { approval } } as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found/i.test(message)) {
        return useCaseFailure("not_found", "Approval not found", 404);
      }
      return useCaseFailure("validation_error", message, 400);
    }
  },
});

const ControlIntentInputSchema = z
  .object({
    projectId: z.string().min(1),
    kind: z.string().min(1),
    targetType: z.string().min(1),
    targetId: z.string().min(1),
    note: z.union([z.string(), z.null()]).optional(),
    surfaceRef: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

export const SubmitControlIntent = defineCommand<
  Record<string, unknown>,
  unknown,
  AppRuntime
>({
  name: "delivery.controlIntent.submit",
  input: z
    .record(z.string(), z.unknown())
    .transform((value) => value as Record<string, unknown>),
  output: z.any(),
  http: { method: "POST", path: "/api/v1/control/intents" },
  async handle(input, runtime) {
    if (!runtime.auth) {
      return useCaseFailure("unauthorized", "Authentication required", 401);
    }
    const parsed = ControlIntentInputSchema.safeParse(input);
    if (!parsed.success) {
      return useCaseFailure(
        "validation_error",
        "projectId, kind, targetType, and targetId are required",
        400,
      );
    }
    const payload = {
      projectId: parsed.data.projectId,
      kind: parsed.data.kind as "approve" | "reject" | "hold" | "claim" | "cancel" | "retry",
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      actor: runtime.auth.username,
      surface: "api" as const,
      surfaceRef: parsed.data.surfaceRef ?? null,
      note: parsed.data.note ?? null,
    };
    const result = await runtime.delivery.submitControlIntent(payload);
    return { ok: true, value: { intent: result.intent } } as const;
  },
});

const ListIntegrationsInputSchema = z.object({
  status: optionalString.optional(),
  limit: integerFromInput.optional(),
  offset: integerFromInput.optional(),
  sort: optionalString.optional(),
  order: z
    .union([z.enum(["asc", "desc"]), z.null(), z.undefined()])
    .transform((v) => v ?? null)
    .optional(),
  projectId: optionalString.optional(),
  from: optionalString.optional(),
  to: optionalString.optional(),
});

export const ListIntegrations = defineQuery<
  z.infer<typeof ListIntegrationsInputSchema>,
  unknown,
  AppRuntime
>({
  name: "delivery.integrations.list",
  input: ListIntegrationsInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/integrations" },
  async handle(input, runtime) {
    try {
      const page = await runtime.delivery.listIntegrations({
        status: input.status ?? null,
        limit: input.limit ?? null,
        offset: input.offset ?? null,
        sort: input.sort ?? null,
        order: input.order ?? null,
        projectId: input.projectId ?? null,
        from: input.from ?? null,
        to: input.to ?? null,
      });
      return {
        ok: true,
        value: {
          integrations: page.items,
          total: page.total,
          limit: page.limit,
          offset: page.offset,
        },
      } as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return useCaseFailure("validation_error", message, 400);
    }
  },
});

// Run approve/reject HTTP routes are owned by the execution context
// (`/api/v1/runs/{runId}/approve|reject`). Delivery exposes `approveRun` /
// `rejectRun` on its module for programmatic callers but does not re-register
// the routes here.

export const deliveryUseCases = [
  ListApprovals,
  GetApproval,
  ApproveApproval,
  RejectApproval,
  HoldApproval,
  SetApprovalAutonomy,
  SubmitControlIntent,
  ListIntegrations,
] as const;
