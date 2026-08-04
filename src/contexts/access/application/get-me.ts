import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { PublicUser, UserServicePort } from "../ports/user-service";
import { toPublicUser } from "../ports/user-service";

export type GetMeDeps = {
  users: UserServicePort;
};

export type GetMeInput = {
  userId: string;
};

export async function getMeQuery(
  deps: GetMeDeps,
  input: GetMeInput,
): Promise<Result<{ user: PublicUser }, UseCaseFailure>> {
  const record = deps.users.findById(input.userId);
  if (!record) {
    return useCaseFailure("unauthorized", "Authentication required", 401);
  }
  return ok({ user: toPublicUser(record) });
}
