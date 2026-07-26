import { z } from 'zod';

import { UlidSchema } from './ids';

/** Outcome reported by the agent in a handoff document (PRD §14). */
export const HandoffStatusSchema = z.enum([
  'completed',
  'partial',
  'failed',
  'no-change',
]);

export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

export const HandoffValidationStepStatusSchema = z.enum([
  'passed',
  'failed',
  'skipped',
  'not-run',
]);

export type HandoffValidationStepStatus = z.infer<
  typeof HandoffValidationStepStatusSchema
>;

export const HandoffValidationStepSchema = z.object({
  name: z.string().min(1),
  status: HandoffValidationStepStatusSchema,
});

export type HandoffValidationStep = z.infer<typeof HandoffValidationStepSchema>;

export const HandoffValidationSchema = z.object({
  passed: z.boolean(),
  steps: z.array(HandoffValidationStepSchema),
});

export type HandoffValidation = z.infer<typeof HandoffValidationSchema>;

export const HandoffAgentAssessmentSchema = z.object({
  successful: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type HandoffAgentAssessment = z.infer<typeof HandoffAgentAssessmentSchema>;

/** How an attached handoff asset should be consumed by gojo. */
export const HandoffAssetRoleSchema = z.enum([
  'pr-body',
  'pr-title',
  'report',
  'attachment',
]);

export type HandoffAssetRole = z.infer<typeof HandoffAssetRoleSchema>;

/**
 * File or inline blob attached to a handoff (PR bodies, reports, …).
 * Prefer `path` (workspace-relative) for verbose markdown.
 */
export const HandoffAssetSchema = z
  .object({
    role: HandoffAssetRoleSchema,
    path: z.string().min(1).optional(),
    content: z.string().optional(),
    mediaType: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
  })
  .refine((asset) => Boolean(asset.path?.trim() || asset.content !== undefined), {
    message: 'Handoff asset requires path and/or content',
  });

export type HandoffAsset = z.infer<typeof HandoffAssetSchema>;

/** Normalized agent handoff report per PRD §14. */
export const AgentHandoffReportSchema = z.object({
  schemaVersion: z.literal(1),
  runId: UlidSchema,
  status: HandoffStatusSchema,
  summary: z.string().min(1),
  startingCommit: z.string().min(1),
  resultCommit: z.string().min(1),
  filesChanged: z.array(z.string()),
  validation: HandoffValidationSchema,
  decisions: z.array(z.string()),
  unresolvedIssues: z.array(z.string()),
  recommendedNextActions: z.array(z.string()),
  agentAssessment: HandoffAgentAssessmentSchema,
  /** Optional attached files/blobs (e.g. verbose PR body markdown). */
  assets: z.array(HandoffAssetSchema).optional(),
  /**
   * Set by gojo after pull-request integration: real PR URL, or
   * `local://pr/<branch>` when the PR CLI failed.
   */
  prUrl: z.string().min(1).optional(),
});

export type AgentHandoffReport = z.infer<typeof AgentHandoffReportSchema>;

/** Parse and validate a handoff report payload. */
export function parseAgentHandoffReport(input: unknown): AgentHandoffReport {
  return AgentHandoffReportSchema.parse(input);
}

/** Safe-parse variant returning a Zod result. */
export function safeParseAgentHandoffReport(input: unknown) {
  return AgentHandoffReportSchema.safeParse(input);
}
