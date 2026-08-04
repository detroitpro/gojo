import type { ApiTokenRecord, UserRecord } from "@/contexts/access/infrastructure/auth/users";

/**
 * Port over the JSON-facing subset of the user service.
 * The infrastructure adapter wraps the existing SQLite-backed `UserService`.
 */
export interface UserServicePort {
  findById(id: string): UserRecord | null;
  listApiTokens(userId: string): ApiTokenRecord[];
  createApiTokenForUser(
    userId: string,
    name: string,
    options?: { expiresAt?: string | null; scopes?: string[] },
  ): { record: ApiTokenRecord; token: string };
  revokeApiToken(userId: string, tokenId: string): boolean;
}

export type PublicUser = {
  id: string;
  username: string;
  role: string;
  createdAt: string;
};

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
  };
}
