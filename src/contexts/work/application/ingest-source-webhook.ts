import { ok, type Result } from "@/kernel";

import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { WorkStore } from "../ports/work-store";

export type IngestSourceWebhookInput = {
  sourceId: string;
  body: string;
  signature: string;
};

export type IngestSourceWebhookDeps = { store: WorkStore };

export async function ingestSourceWebhookCommand(
  deps: IngestSourceWebhookDeps,
  input: IngestSourceWebhookInput,
): Promise<Result<unknown, UseCaseFailure>> {
  try {
    return ok(
      await deps.store.ingestWebhook(input.sourceId, input.body, input.signature),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return useCaseFailure("validation_error", message, 400);
  }
}
