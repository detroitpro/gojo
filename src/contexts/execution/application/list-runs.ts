import { ok, type Result } from "@/kernel";

import type { RunListQuery, RunListPage, RunReadModel } from "../ports/run-read-model";

export type ListRunsDeps = {
  reads: RunReadModel;
};

export async function listRunsQuery(
  deps: ListRunsDeps,
  input: RunListQuery,
): Promise<Result<RunListPage>> {
  return ok(deps.reads.list(input));
}
