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

/** Latest handoff schema version gojo writes; v1/v2 payloads remain accepted. */
export const HANDOFF_SCHEMA_VERSION = 3;

export const HandoffSubjectActionsSchema = z.object({
  addLabels: z.array(z.string().min(1)).optional(),
  removeLabels: z.array(z.string().min(1)).optional(),
  comment: z.string().min(1).optional(),
  verdict: z.enum(['pass', 'changes-requested', 'reject', 'hold']).optional(),
});

export type HandoffSubjectActions = z.infer<typeof HandoffSubjectActionsSchema>;

/** Semantic outcome categories an agent may claim for a run. */
export const HandoffImpactCategorySchema = z.enum([
  'dependency-update',
  'bug-fix',
  'bug-prevention',
  'documentation',
  'test-coverage',
  'security',
  'feature',
  'performance',
  'maintenance',
]);

export type HandoffImpactCategory = z.infer<typeof HandoffImpactCategorySchema>;

export const HandoffImpactEvidenceSchema = z.object({
  /** Workspace-relative files supporting the claim. */
  files: z.array(z.string()).default([]),
  /** Validation step names that exercised the change. */
  validationSteps: z.array(z.string()).default([]),
  /** Issue/PR/commit URLs or ids supporting the claim. */
  references: z.array(z.string()).default([]),
});

export type HandoffImpactEvidence = z.infer<typeof HandoffImpactEvidenceSchema>;

/**
 * One concrete impact claim: one item per subject (a package, an issue,
 * a doc page) — never aggregate totals.
 */
export const HandoffImpactItemSchema = z.object({
  category: HandoffImpactCategorySchema,
  /** Concrete subject: package name, issue id, doc path, module. */
  subject: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.5),
  evidence: HandoffImpactEvidenceSchema.default({
    files: [],
    validationSteps: [],
    references: [],
  }),
});

export type HandoffImpactItem = z.infer<typeof HandoffImpactItemSchema>;

export const HandoffImpactSchema = z.object({
  items: z.array(HandoffImpactItemSchema),
});

export type HandoffImpact = z.infer<typeof HandoffImpactSchema>;

/** Normalized agent handoff report per PRD §14. Accepts schema v1 through v3. */
export const AgentHandoffReportSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
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
  /** Structured impact claims (schema v2). One item per concrete subject. */
  impact: HandoffImpactSchema.optional(),
  /** Optional attached files/blobs (e.g. verbose PR body markdown). */
  assets: z.array(HandoffAssetSchema).optional(),
  /** Requested source mutations; gojo validates and applies them with platform credentials. */
  subjectActions: HandoffSubjectActionsSchema.optional(),
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

export interface NormalizedHandoff {
  /** Fully valid report, or null when the payload failed schema validation. */
  report: AgentHandoffReport | null;
  /** Human-readable validation problems (empty when report is valid). */
  warnings: string[];
}

const MAX_NORMALIZE_WARNINGS = 5;

/**
 * Validate an agent-written handoff payload. Invalid payloads never throw;
 * callers fall back to the platform baseline and keep raw JSON for diagnosis.
 */
export function normalizeAgentHandoff(input: unknown): NormalizedHandoff {
  const result = AgentHandoffReportSchema.safeParse(input);
  if (result.success) {
    return { report: result.data, warnings: [] };
  }
  const warnings = result.error.issues
    .slice(0, MAX_NORMALIZE_WARNINGS)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
  return { report: null, warnings };
}

/** Optional top-level fields that must not invalidate the rest of a handoff. */
const RECOVERABLE_OPTIONAL_KEYS = new Set(['impact', 'assets', 'prUrl']);

function formatHandoffIssues(
  issues: { path: PropertyKey[]; message: string }[],
): string[] {
  return issues
    .slice(0, MAX_NORMALIZE_WARNINGS)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/**
 * Parse a handoff for platform consumers (review verdicts, subjectActions).
 * Drops invalid optional sections (`impact`, `assets`, `prUrl`) and retries so a
 * bad category inventing like `code-quality` cannot erase a valid verdict.
 */
export function recoverAgentHandoffReport(input: unknown): NormalizedHandoff {
  const first = AgentHandoffReportSchema.safeParse(input);
  if (first.success) {
    return { report: first.data, warnings: [] };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { report: null, warnings: formatHandoffIssues(first.error.issues) };
  }

  const recoverablePaths = first.error.issues.filter(
    (issue) =>
      issue.path.length > 0 &&
      typeof issue.path[0] === 'string' &&
      RECOVERABLE_OPTIONAL_KEYS.has(issue.path[0]),
  );
  if (recoverablePaths.length === 0) {
    return { report: null, warnings: formatHandoffIssues(first.error.issues) };
  }

  const stripped: Record<string, unknown> = {
    ...(input as Record<string, unknown>),
  };
  const dropped = new Set<string>();
  for (const issue of recoverablePaths) {
    const key = issue.path[0];
    if (typeof key === 'string' && key in stripped) {
      delete stripped[key];
      dropped.add(key);
    }
  }

  const retry = AgentHandoffReportSchema.safeParse(stripped);
  if (!retry.success) {
    return { report: null, warnings: formatHandoffIssues(first.error.issues) };
  }

  const warnings = [
    ...[...dropped].map(
      (key) => `handoff-validation: ${key} section failed validation and was ignored`,
    ),
    ...formatHandoffIssues(recoverablePaths),
  ];
  return { report: retry.data, warnings };
}

/**
 * Leniently extract valid subjectActions from a raw handoff payload when the
 * full document cannot be recovered.
 */
export function extractHandoffSubjectActions(
  input: unknown,
): HandoffSubjectActions | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const subjectActions = (input as Record<string, unknown>)['subjectActions'];
  if (subjectActions === undefined || subjectActions === null) {
    return null;
  }
  const parsed = HandoffSubjectActionsSchema.safeParse(subjectActions);
  return parsed.success ? parsed.data : null;
}

/**
 * Leniently extract valid impact items from an arbitrary handoff payload,
 * so a handoff that fails full validation can still contribute claims.
 */
export function extractHandoffImpactItems(input: unknown): {
  items: HandoffImpactItem[];
  invalid: boolean;
} {
  if (!input || typeof input !== 'object') {
    return { items: [], invalid: false };
  }
  const impact = (input as Record<string, unknown>)['impact'];
  if (impact === undefined || impact === null) {
    return { items: [], invalid: false };
  }
  const parsed = HandoffImpactSchema.safeParse(impact);
  if (!parsed.success) {
    return { items: [], invalid: true };
  }
  return { items: parsed.data.items, invalid: false };
}
