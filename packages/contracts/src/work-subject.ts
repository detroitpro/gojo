import { z } from 'zod';

export const RunSubjectFeedbackSchema = z.object({
  round: z.number().int().positive(),
  checksSummary: z.string().optional(),
  reviewSummary: z.string().optional(),
  references: z.array(z.string()).optional(),
});

export const RunSubjectSchema = z.object({
  workItemId: z.string().min(1),
  sourceId: z.string().min(1).nullable(),
  kind: z.string().min(1),
  nativeKey: z.string().min(1).nullable(),
  title: z.string(),
  summary: z.string(),
  labels: z.array(z.string()),
  webUrl: z.string().nullable(),
  nativeState: z.string().nullable(),
  feedback: RunSubjectFeedbackSchema.optional(),
});

export type RunSubject = z.infer<typeof RunSubjectSchema>;
export type RunSubjectFeedback = z.infer<typeof RunSubjectFeedbackSchema>;
