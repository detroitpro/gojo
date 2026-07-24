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
