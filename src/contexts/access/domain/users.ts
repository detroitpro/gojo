import type { UserRole } from "@gojo/contracts";

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  passwordUpdatedAt: string;
}

/** Public user fields — never includes password hashes. */
export interface UserPublic {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

export interface ApiTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  name: string;
  scopesJson: string;
  createdAt: string;
  expiresAt: string | null;
}
