import { z } from "zod";

import { PlatformEventTopicSchema } from "@shared/events";

const WsHttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const RunEventCursorSchema = z.object({
  durable: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
});

export const ClientReqFrameSchema = z.object({
  t: z.literal("req"),
  id: z.number().int().positive(),
  method: WsHttpMethodSchema,
  path: z.string().min(1),
  body: z.unknown().optional(),
});

export const ClientPlatformSubFrameSchema = z.object({
  t: z.literal("sub"),
  id: z.number().int().positive(),
  channel: z.literal("platform"),
  topics: z.array(PlatformEventTopicSchema).optional(),
  projectId: z.string().min(1).nullable().optional(),
  after: z.number().int().nonnegative().optional(),
});

export const ClientRunSubFrameSchema = z.object({
  t: z.literal("sub"),
  id: z.number().int().positive(),
  channel: z.literal("run"),
  runId: z.string().min(1),
  after: RunEventCursorSchema.optional(),
});

export const ClientUnsubFrameSchema = z.object({
  t: z.literal("unsub"),
  id: z.number().int().positive(),
});

export type ParsedClientFrame =
  | z.infer<typeof ClientReqFrameSchema>
  | z.infer<typeof ClientPlatformSubFrameSchema>
  | z.infer<typeof ClientRunSubFrameSchema>
  | z.infer<typeof ClientUnsubFrameSchema>;

/** Parse a raw WebSocket text payload into a validated client frame. */
export function parseClientFrame(
  raw: string,
): { ok: true; frame: ParsedClientFrame } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, error: "Invalid JSON frame" };
  }

  // Zod's nested discriminatedUnion on `sub` doesn't compose with top-level `t`
  // easily, so validate by shape manually with the leaf schemas.
  if (!parsed || typeof parsed !== "object" || !("t" in parsed)) {
    return { ok: false, error: "Missing frame type" };
  }
  const t = (parsed as { t: unknown }).t;
  if (t === "req") {
    const result = ClientReqFrameSchema.safeParse(parsed);
    return result.success
      ? { ok: true, frame: result.data }
      : { ok: false, error: result.error.issues[0]?.message ?? "Invalid req frame" };
  }
  if (t === "unsub") {
    const result = ClientUnsubFrameSchema.safeParse(parsed);
    return result.success
      ? { ok: true, frame: result.data }
      : { ok: false, error: result.error.issues[0]?.message ?? "Invalid unsub frame" };
  }
  if (t === "sub") {
    const channel = (parsed as { channel?: unknown }).channel;
    if (channel === "platform") {
      const result = ClientPlatformSubFrameSchema.safeParse(parsed);
      return result.success
        ? { ok: true, frame: result.data }
        : { ok: false, error: result.error.issues[0]?.message ?? "Invalid platform sub" };
    }
    if (channel === "run") {
      const result = ClientRunSubFrameSchema.safeParse(parsed);
      return result.success
        ? { ok: true, frame: result.data }
        : { ok: false, error: result.error.issues[0]?.message ?? "Invalid run sub" };
    }
    return { ok: false, error: "Unknown subscription channel" };
  }
  return { ok: false, error: "Unknown frame type" };
}
