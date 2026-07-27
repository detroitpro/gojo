import { z } from "zod";

export const PlatformEventTopicSchema = z.enum([
  "dashboard",
  "overview",
  "impact",
  "queue",
  "runs",
  "tasks",
  "schedules",
  "projects",
  "work",
  "sources",
]);
export type PlatformEventTopic = z.infer<typeof PlatformEventTopicSchema>;

export const PlatformChangeEventSchema = z.object({
  sequence: z.number().int().positive(),
  id: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  type: z.string().min(1),
  entityKind: z.string().min(1),
  entityId: z.string().min(1),
  topics: z.array(PlatformEventTopicSchema).min(1),
  data: z.unknown(),
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type PlatformChangeEvent = z.infer<typeof PlatformChangeEventSchema>;

export interface CreatePlatformChangeEventInput {
  projectId?: string | null;
  type: string;
  entityKind: string;
  entityId: string;
  topics: PlatformEventTopic[];
  data?: unknown;
  occurredAt?: string;
}
