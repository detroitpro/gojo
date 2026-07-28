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
  validation: unknown | null;
  failure: unknown | null;
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

export interface RunHandoffSummary {
  summary: string | null;
  status: string | null;
}

function readHandoffFields(value: unknown): RunHandoffSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const summary = typeof record["summary"] === "string" ? record["summary"].trim() : "";
  const status = typeof record["status"] === "string" ? record["status"] : null;
  if (summary.length === 0 && status === null) {
    return null;
  }
  return { summary: summary.length > 0 ? summary : null, status };
}

/**
 * Report text as written by the agent. Prefers the merged artifact; falls back to the
 * raw attempt handoff so runs that failed before the artifact was written still report.
 */
export function resolveRunHandoffSummary(ctx: AppContext, runId: string): RunHandoffSummary {
  const artifactPath = join(ctx.paths.artifacts, runId, "handoff.json");
  if (existsSync(artifactPath)) {
    try {
      const fields = readHandoffFields(JSON.parse(readFileSync(artifactPath, "utf8")));
      if (fields) {
        return fields;
      }
    } catch {
      // Fall through to the attempt record.
    }
  }

  const attempts = ctx.repos.attempts.listByRun(runId);
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const raw = attempts[index]?.handoffJson;
    if (!raw) {
      continue;
    }
    try {
      const fields = readHandoffFields(JSON.parse(raw));
      if (fields) {
        return fields;
      }
    } catch {
      continue;
    }
  }

  return { summary: null, status: null };
}

export function getRunArtifacts(ctx: AppContext, runId: string): RunArtifactsResult {
  const dir = join(ctx.paths.artifacts, runId);
  const handoffPath = join(dir, "handoff.json");
  const validationPath = join(dir, "validation.json");
  const failurePath = join(dir, "failure.json");
  return {
    path: dir,
    exists: existsSync(dir),
    handoff: existsSync(handoffPath)
      ? (JSON.parse(readFileSync(handoffPath, "utf8")) as unknown)
      : null,
    validation: existsSync(validationPath)
      ? (JSON.parse(readFileSync(validationPath, "utf8")) as unknown)
      : null,
    failure: existsSync(failurePath)
      ? (JSON.parse(readFileSync(failurePath, "utf8")) as unknown)
      : null,
  };
}
