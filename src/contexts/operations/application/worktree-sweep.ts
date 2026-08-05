import { err, ok, type Result } from "@/kernel";

import type { WorktreeSweepPort } from "../ports/worktree-sweep";

export async function sweepWorktreesCommand(deps: {
  sweep: WorktreeSweepPort;
}): Promise<Result<Awaited<ReturnType<WorktreeSweepPort["sweep"]>>>> {
  try {
    return ok(await deps.sweep.sweep());
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}
