import { ok, type Result } from "@/kernel";

import type { WorkStore } from "../ports/work-store";

export type RebuildWorkStatusInput = {
  projectId?: string | null;
  from?: string | null;
};

export type RebuildWorkStatusDeps = { store: WorkStore };

export async function rebuildWorkStatusCommand(
  deps: RebuildWorkStatusDeps,
  input: RebuildWorkStatusInput,
): Promise<Result<{ rebuilt: true; deleted: number }>> {
  const deleted = deps.store.rebuildStatusRollup({
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.from ? { from: input.from } : {}),
  });
  return ok({ rebuilt: true, deleted });
}
