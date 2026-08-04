import { err, ok, type Result } from "@/kernel";

import type {
  RunArtifactsRead,
  RunDetail,
  RunDiffRead,
  RunReadModel,
} from "../ports/run-read-model";

export type GetRunDeps = { reads: RunReadModel };

export async function getRunQuery(
  deps: GetRunDeps,
  input: { runId: string },
): Promise<Result<RunDetail>> {
  const detail = deps.reads.detail(input.runId);
  if (!detail) {
    return err(`run not found: ${input.runId}`);
  }
  return ok(detail);
}

export async function getRunArtifactsQuery(
  deps: GetRunDeps,
  input: { runId: string },
): Promise<Result<RunArtifactsRead>> {
  return ok(deps.reads.artifacts(input.runId));
}

export async function getRunDiffQuery(
  deps: GetRunDeps,
  input: { runId: string },
): Promise<Result<RunDiffRead>> {
  try {
    const diff = await deps.reads.diff(input.runId);
    return ok(diff);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(message);
  }
}
