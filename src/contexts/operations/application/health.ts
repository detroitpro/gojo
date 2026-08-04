import { ok, type Result } from "@/kernel";

export type HealthDeps = { isPaused: () => boolean };

export async function healthQuery(
  deps: HealthDeps,
): Promise<Result<{ status: "ok"; paused: boolean; version: string }>> {
  return ok({ status: "ok", paused: deps.isPaused(), version: "0.1.0" });
}
