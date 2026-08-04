import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { ApprovalStore } from "../ports/approval-store";

export type RunApproveInput = { id: string };
export type RunApproveDeps = { store: ApprovalStore };

export async function runApproveCommand(
  deps: RunApproveDeps,
  input: RunApproveInput,
): Promise<Result<{ run: { id: string; state: string } | null }, UseCaseFailure>> {
  const run = deps.store.findRun(input.id);
  if (!run) return useCaseFailure("not_found", "Run not found", 404);
  await deps.store.approveRun(input.id);
  return ok({ run: deps.store.findRun(input.id) });
}

export type RunRejectInput = {
  id: string;
  reason?: string | null;
};

export async function runRejectCommand(
  deps: RunApproveDeps,
  input: RunRejectInput,
): Promise<Result<{ run: { id: string; state: string } | null }, UseCaseFailure>> {
  const run = deps.store.findRun(input.id);
  if (!run) return useCaseFailure("not_found", "Run not found", 404);
  await deps.store.rejectRun(input.id, input.reason ?? null);
  return ok({ run: deps.store.findRun(input.id) });
}
