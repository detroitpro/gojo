import type { AppContext } from "@/platform/app-context";
import { diffNameOnly } from "@/infrastructure/git/git";

import type { RunDiffRead } from "../ports/run-read-model";

export type RunDiffResult = RunDiffRead;

export async function getRunDiff(ctx: AppContext, runId: string): Promise<RunDiffRead> {
  const attempts = ctx.repos.attempts.listByRun(runId);
  const attempt = attempts[attempts.length - 1];
  if (!attempt?.workspacePath) {
    throw new Error("attempt workspace not available");
  }
  const files = await diffNameOnly(attempt.workspacePath, attempt.startingCommit ?? undefined);
  return { files };
}
