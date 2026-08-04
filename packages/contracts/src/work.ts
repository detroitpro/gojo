import { z } from "zod";

export const WorkExecutionSchema = z.enum([
  "queued",
  "preparing",
  "running",
  "validating",
  "awaiting-approval",
  "integrating",
  "reporting",
  "terminal",
  "none",
]);
export type WorkExecution = z.infer<typeof WorkExecutionSchema>;

export const WorkDeliverySchema = z.enum([
  "none",
  "draft",
  "open",
  "review",
  "blocked",
  "merged",
  "closed",
]);
export type WorkDelivery = z.infer<typeof WorkDeliverySchema>;

export const WorkOutcomeSchema = z.enum([
  "pending",
  "succeeded",
  "failed",
  "no-change",
  "canceled",
]);
export type WorkOutcome = z.infer<typeof WorkOutcomeSchema>;

export const WorkAttentionSchema = z.enum([
  "none",
  "approval",
  "blocked",
  "sync-error",
  "stale",
]);
export type WorkAttention = z.infer<typeof WorkAttentionSchema>;

export const WorkResolutionSchema = z.enum(["operator"]);
export type WorkResolution = z.infer<typeof WorkResolutionSchema>;

export const WorkRecheckStatusSchema = z.enum(["active", "terminal", "unresolved"]);
export type WorkRecheckStatus = z.infer<typeof WorkRecheckStatusSchema>;

export const WorkProvenanceSchema = z.enum([
  "gojo-agent",
  "human",
  "bot",
  "external",
]);
export type WorkProvenance = z.infer<typeof WorkProvenanceSchema>;

export const SourceSyncStateSchema = z.enum([
  "pending",
  "syncing",
  "current",
  "stale",
  "error",
  "unsupported",
]);
export type SourceSyncState = z.infer<typeof SourceSyncStateSchema>;

export const SourceCapabilitiesSchema = z.object({
  read: z.boolean(),
  list: z.boolean(),
  webhooks: z.boolean(),
  write: z.boolean(),
  workKinds: z.array(z.string().min(1)),
  reviews: z.boolean().optional(),
  checks: z.boolean().optional(),
  labels: z.boolean().optional(),
});
export type SourceCapabilities = z.infer<typeof SourceCapabilitiesSchema>;

export const WorkItemSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  sourceId: z.string().nullable(),
  kind: z.string().min(1),
  nativeKey: z.string().nullable(),
  title: z.string(),
  summary: z.string(),
  execution: WorkExecutionSchema,
  delivery: WorkDeliverySchema,
  outcome: WorkOutcomeSchema,
  attention: WorkAttentionSchema,
  provenance: WorkProvenanceSchema,
  actorName: z.string().nullable(),
  profileId: z.string().nullable(),
  labels: z.array(z.string()),
  nativeState: z.string().nullable(),
  nativeJson: z.string(),
  webUrl: z.string().nullable(),
  observedAt: z.string().nullable(),
  nextSyncAt: z.string().nullable(),
  syncState: SourceSyncStateSchema,
  lastError: z.string().nullable(),
  resolution: WorkResolutionSchema.nullable(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  /** Durable agent name for runs, or delivering run agent for forge rows. */
  agentName: z.string().nullable().optional(),
  /** Profile/adapter name, actor, or provenance fallback. */
  agentLabel: z.string().nullable().optional(),
});
export type WorkItem = z.infer<typeof WorkItemSchema> & {
  /** Outbound `delivers` targets (PRs/issues), populated on list responses for runs. */
  deliveredWork?: WorkItem[];
};

export interface WorkRecheckResult {
  status: WorkRecheckStatus;
  work: WorkItem;
  detail: string | null;
}

export interface WorkResolveInput {
  resolvedBy?: string | null;
  note?: string | null;
}

export const WorkStatusCountsSchema = z.object({
  working: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  needsAttention: z.number().int().nonnegative(),
  verifiedOpen: z.number().int().nonnegative(),
  staleOpen: z.number().int().nonnegative(),
});
export type WorkStatusCounts = z.infer<typeof WorkStatusCountsSchema>;

export const WorkStatusCompareWindowSchema = z.enum(["24h", "7d", "30d"]);
export type WorkStatusCompareWindow = z.infer<typeof WorkStatusCompareWindowSchema>;

export const WorkStatusSchema = WorkStatusCountsSchema.extend({
  asOf: z.string().nullable(),
  previous: WorkStatusCountsSchema.nullable(),
  previousAsOf: z.string().nullable(),
  compareWindow: WorkStatusCompareWindowSchema,
});
export type WorkStatus = z.infer<typeof WorkStatusSchema>;

export function compareWindowToMs(window: WorkStatusCompareWindow): number {
  switch (window) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
  }
}

export function parseCompareWindow(
  value: string | null | undefined,
  fallback: WorkStatusCompareWindow = "24h",
): WorkStatusCompareWindow {
  const parsed = WorkStatusCompareWindowSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function parseWorkFilter<T>(
  schema: z.ZodType<T>,
  value: string | null | undefined,
): T | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Parse work-list `provenance` query param; invalid values become `null`. */
export function parseWorkProvenance(
  value: string | null | undefined,
): WorkProvenance | null {
  return parseWorkFilter(WorkProvenanceSchema, value);
}

/** Parse work-list `delivery` query param; invalid values become `null`. */
export function parseWorkDelivery(value: string | null | undefined): WorkDelivery | null {
  return parseWorkFilter(WorkDeliverySchema, value);
}

/** Parse work-list `attention` query param; invalid values become `null`. */
export function parseWorkAttention(value: string | null | undefined): WorkAttention | null {
  return parseWorkFilter(WorkAttentionSchema, value);
}

/** Parse work-list `execution` query param; invalid values become `null`. */
export function parseWorkExecution(value: string | null | undefined): WorkExecution | null {
  return parseWorkFilter(WorkExecutionSchema, value);
}

/** Parse work-list `outcome` query param; invalid values become `null`. */
export function parseWorkOutcome(value: string | null | undefined): WorkOutcome | null {
  return parseWorkFilter(WorkOutcomeSchema, value);
}

export const WorkLinkTypeSchema = z.enum([
  "executes",
  "delivers",
  "tracks",
  "implements",
  "retry-of",
  "heals",
  "supersedes",
]);
export type WorkLinkType = z.infer<typeof WorkLinkTypeSchema>;
