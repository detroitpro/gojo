import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";
import { SubmitControlIntentSchema, type ControlIntent } from "@shared/approvals";

import type { ApprovalStore } from "../ports/approval-store";

export type SubmitControlIntentInput = unknown;
export type SubmitControlIntentDeps = { store: ApprovalStore };

export async function submitControlIntentCommand(
  deps: SubmitControlIntentDeps,
  input: SubmitControlIntentInput,
): Promise<
  Result<{ intent: ControlIntent; successStatus: 201 | 409 }, UseCaseFailure>
> {
  const parsed = SubmitControlIntentSchema.safeParse(input);
  if (!parsed.success) {
    return useCaseFailure(
      "validation_error",
      "projectId, kind, targetType, and targetId are required",
      400,
    );
  }
  const intent = await deps.store.submitIntent(parsed.data);
  return ok({ intent, successStatus: intent.state === "applied" ? 201 : 409 });
}
