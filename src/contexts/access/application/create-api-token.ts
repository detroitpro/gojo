import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import { parseScopes } from "../domain/tokens";
import type { UserServicePort } from "../ports/user-service";

export type CreateApiTokenDeps = {
  users: UserServicePort;
};

export type CreateApiTokenInput = {
  userId: string;
  name: string;
  scopes?: string[];
  expiresAt?: string | null;
};

export type CreateApiTokenOutput = {
  id: string;
  name: string;
  token: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
};

export async function createApiTokenCommand(
  deps: CreateApiTokenDeps,
  input: CreateApiTokenInput,
): Promise<Result<CreateApiTokenOutput, UseCaseFailure>> {
  const name = input.name?.trim();
  if (!name) {
    return useCaseFailure("validation_error", "name is required", 400);
  }
  if (
    input.expiresAt !== undefined &&
    input.expiresAt !== null &&
    !Number.isFinite(new Date(input.expiresAt).getTime())
  ) {
    return useCaseFailure(
      "validation_error",
      "expiresAt must be an ISO date-time",
      400,
    );
  }
  const scopes = Array.isArray(input.scopes)
    ? input.scopes.filter(
        (scope): scope is string => typeof scope === "string" && scope.length > 0,
      )
    : [];
  const created = deps.users.createApiTokenForUser(input.userId, name, {
    scopes,
    expiresAt: input.expiresAt ?? null,
  });
  return ok({
    id: created.record.id,
    name: created.record.name,
    token: created.token,
    scopes: parseScopes(created.record.scopesJson),
    createdAt: created.record.createdAt,
    expiresAt: created.record.expiresAt,
  });
}
