import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AppContext } from "@/app/context";
import { diffNameOnly } from "@/git/git";

export interface RunDiffResult {
  files: string[];
}

export interface RunArtifactsResult {
  path: string;
  exists: boolean;
  handoff: unknown | null;
}

export async function getRunDiff(ctx: AppContext, runId: string): Promise<RunDiffResult> {
  const attempts = ctx.repos.attempts.listByRun(runId);
  const attempt = attempts[attempts.length - 1];
  if (!attempt?.workspacePath) {
    throw new Error("attempt workspace not available");
  }
  const files = await diffNameOnly(attempt.workspacePath, attempt.startingCommit ?? undefined);
  return { files };
}

export function getRunArtifacts(ctx: AppContext, runId: string): RunArtifactsResult {
  const dir = join(ctx.paths.artifacts, runId);
  const handoffPath = join(dir, "handoff.json");
  return {
    path: dir,
    exists: existsSync(dir),
    handoff: existsSync(handoffPath)
      ? (JSON.parse(readFileSync(handoffPath, "utf8")) as unknown)
      : null,
  };
}
