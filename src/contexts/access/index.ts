import type { Database } from "@/infrastructure/persistence";

import { createApiTokenCommand } from "./application/create-api-token";
import { getMeQuery } from "./application/get-me";
import {
  listApiTokensQuery,
  type ListApiTokensInput,
  type ListApiTokensOutput,
} from "./application/list-api-tokens";
import { revokeApiTokenCommand } from "./application/revoke-api-token";
import { createSqliteUserService } from "./infrastructure/sqlite-user-service";
import type { UserServicePort } from "./ports/user-service";

export * from "./contract";

export type AccessModule = {
  users: UserServicePort;
  getMe: (userId: string) => ReturnType<typeof getMeQuery>;
  listTokens: (
    input: ListApiTokensInput,
  ) => Promise<Awaited<ReturnType<typeof listApiTokensQuery>>>;
  createToken: (
    input: Parameters<typeof createApiTokenCommand>[1],
  ) => ReturnType<typeof createApiTokenCommand>;
  revokeToken: (
    input: Parameters<typeof revokeApiTokenCommand>[1],
  ) => ReturnType<typeof revokeApiTokenCommand>;
};

export type BuildAccessModuleDeps = {
  db: Database;
  users?: UserServicePort;
};

/** Compose the access module with default SQLite adapters. */
export function buildAccessModule(deps: BuildAccessModuleDeps): AccessModule {
  const users = deps.users ?? createSqliteUserService(deps.db);
  return {
    users,
    getMe: (userId) => getMeQuery({ users }, { userId }),
    listTokens: (input) => listApiTokensQuery({ users }, input),
    createToken: (input) => createApiTokenCommand({ users }, input),
    revokeToken: (input) => revokeApiTokenCommand({ users }, input),
  };
}

export type { ListApiTokensOutput };
