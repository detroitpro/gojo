import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type { UserServicePort } from "../ports/user-service";

export type RevokeApiTokenDeps = {
  users: UserServicePort;
};

export type RevokeApiTokenInput = {
  userId: string;
  tokenId: string;
};

export async function revokeApiTokenCommand(
  deps: RevokeApiTokenDeps,
  input: RevokeApiTokenInput,
): Promise<Result<{ revoked: true }, UseCaseFailure>> {
  if (!input.tokenId) {
    return useCaseFailure("validation_error", "tokenId is required", 400);
  }
  const revoked = deps.users.revokeApiToken(input.userId, input.tokenId);
  if (!revoked) {
    return useCaseFailure("not_found", "Token not found", 404);
  }
  return ok({ revoked: true });
}
