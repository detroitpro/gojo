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
  agentProfileId: z.string().nullable(),
  labels: z.array(z.string()),
  nativeState: z.string().nullable(),
  nativeJson: z.string(),
  webUrl: z.string().nullable(),
  observedAt: z.string().nullable(),
  nextSyncAt: z.string().nullable(),
  syncState: SourceSyncStateSchema,
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

export interface WorkStatus {
  working: number;
  queued: number;
  needsAttention: number;
  verifiedOpen: number;
  staleOpen: number;
  asOf: string | null;
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
