import { z } from 'zod';

export const ApprovalSubjectTypeSchema = z.enum([
  'pull-request',
  'run',
  'conflict',
  'retry',
]);
export const ApprovalAutonomySchema = z.enum(['manual', 'reviewer', 'auto']);
export const ApprovalStateSchema = z.enum([
  'pending-review',
  'awaiting-human',
  'approved',
  'rejected',
  'held',
  'applying',
  'applied',
  'failed',
  'expired',
]);
export const ReviewVerdictSchema = z.enum([
  'pass',
  'changes-requested',
  'reject',
  'hold',
]);
export const ChecksStateSchema = z.enum(['pending', 'success', 'failure', 'unknown']);

export const CreateApprovalSchema = z.object({
  projectId: z.string().min(1),
  subjectType: ApprovalSubjectTypeSchema,
  subjectId: z.string().min(1),
  runId: z.string().min(1).nullable().optional(),
  workItemId: z.string().min(1).nullable().optional(),
  reason: z.string().optional(),
  autonomy: ApprovalAutonomySchema,
  state: ApprovalStateSchema.optional(),
  reviewVerdict: ReviewVerdictSchema.nullable().optional(),
  checksState: ChecksStateSchema.nullable().optional(),
  evidence: z.record(z.unknown()).optional(),
  attempts: z.number().int().min(0).optional(),
  nextAttemptAt: z.string().datetime().nullable().optional(),
});

export const ApprovalSchema = CreateApprovalSchema.extend({
  id: z.string().min(1),
  reason: z.string(),
  state: ApprovalStateSchema,
  reviewVerdict: ReviewVerdictSchema.nullable(),
  checksState: ChecksStateSchema.nullable(),
  evidence: z.record(z.unknown()),
  decidedBy: z.string().nullable(),
  decidedVia: z.string().nullable(),
  note: z.string().nullable(),
  attempts: z.number().int().min(0),
  nextAttemptAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ControlIntentKindSchema = z.enum([
  'approve',
  'reject',
  'hold',
  'claim',
  'cancel',
  'retry',
]);
export const ControlIntentSurfaceSchema = z.enum([
  'ui',
  'cli',
  'api',
  'forge-comment',
  'chat',
  'system',
]);
export const ControlIntentStateSchema = z.enum([
  'applied',
  'rejected',
  'duplicate',
  'failed',
]);

export const SubmitControlIntentSchema = z.object({
  projectId: z.string().min(1),
  kind: ControlIntentKindSchema,
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  actor: z.string().min(1),
  surface: ControlIntentSurfaceSchema,
  surfaceRef: z.string().min(1).nullable().optional(),
  note: z.string().nullable().optional(),
});

export const ControlIntentSchema = SubmitControlIntentSchema.extend({
  id: z.string().min(1),
  surfaceRef: z.string().nullable(),
  note: z.string().nullable(),
  state: ControlIntentStateSchema,
  error: z.string().nullable(),
  createdAt: z.string(),
});

export type Approval = z.infer<typeof ApprovalSchema>;
export type CreateApproval = z.infer<typeof CreateApprovalSchema>;
export type ApprovalAutonomy = z.infer<typeof ApprovalAutonomySchema>;
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
export type ChecksState = z.infer<typeof ChecksStateSchema>;
export type ControlIntent = z.infer<typeof ControlIntentSchema>;
export type SubmitControlIntent = z.infer<typeof SubmitControlIntentSchema>;
