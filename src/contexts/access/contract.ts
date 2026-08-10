/**
 * Public surface of the access context.
 * Other contexts may import only from this module.
 */
export type {
  ApiTokenView,
} from "./domain/tokens";
export {
  isAgentRunToken,
  matchesTokenQuery,
  parseScopes,
  toApiTokenView,
} from "./domain/tokens";

export type {
  PublicUser,
  UserServicePort,
} from "./ports/user-service";
export { toPublicUser } from "./ports/user-service";

export type { GetMeDeps, GetMeInput } from "./application/get-me";
export { getMeQuery } from "./application/get-me";

export type {
  ListApiTokensDeps,
  ListApiTokensInput,
  ListApiTokensOutput,
} from "./application/list-api-tokens";
export { listApiTokensQuery } from "./application/list-api-tokens";

export type {
  CreateApiTokenDeps,
  CreateApiTokenInput,
  CreateApiTokenOutput,
} from "./application/create-api-token";
export { createApiTokenCommand } from "./application/create-api-token";

export type {
  RevokeApiTokenDeps,
  RevokeApiTokenInput,
} from "./application/revoke-api-token";
export { revokeApiTokenCommand } from "./application/revoke-api-token";

export type { ApiTokenRecord, UserPublic, UserRecord } from "./domain/users";
export { UserService } from "./infrastructure/auth/users";
export { SecretStore } from "./infrastructure/secrets/store";
export {
  createSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./infrastructure/auth/session";
export {
  createApiToken,
  hashToken,
  isValidTokenFormat,
  verifyToken,
} from "./infrastructure/auth/tokens";
export { hashPassword, verifyPassword } from "./infrastructure/auth/password";

export { createSecretRepository } from "./infrastructure/secret-repositories";
