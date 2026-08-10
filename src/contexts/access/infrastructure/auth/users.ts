import { randomBytes } from "node:crypto";

import { ulid } from "ulid";

import type { UserRole } from "@gojo/contracts";

import type {
  ApiTokenRecord,
  UserPublic,
  UserRecord,
} from "@/contexts/access/domain/users";
import type { Database } from "@/infrastructure/persistence/db";

import { hashPassword, verifyPassword } from "./password";
import { createSessionToken as buildSessionToken, verifySessionToken as parseSessionToken } from "./session";
import { createApiToken, hashToken, verifyToken } from "./tokens";

export type { ApiTokenRecord, UserPublic, UserRecord } from "@/contexts/access/domain/users";

const SESSION_SECRET_NAME = "__gojo_session_secret__";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
  password_updated_at: string | null;
}

interface ApiTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  name: string;
  scopes_json: string;
  created_at: string;
  expires_at: string | null;
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    passwordUpdatedAt: row.password_updated_at ?? row.created_at,
  };
}

function toPublic(user: UserRecord): UserPublic {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertPasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

export class UserService {
  constructor(private readonly db: Database) {}

  countUsers(): number {
    const row = this.db
      .connection()
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM users")
      .get();
    return row?.count ?? 0;
  }

  listUsers(): UserPublic[] {
    const rows = this.db
      .connection()
      .query<UserRow, []>("SELECT * FROM users ORDER BY created_at ASC")
      .all();
    return rows.map((row) => toPublic(mapUser(row)));
  }

  async createUser(username: string, password: string, role: UserRole = "admin"): Promise<UserRecord> {
    assertPasswordStrength(password);
    const id = ulid();
    const createdAt = nowIso();
    const passwordHash = await hashPassword(password);

    this.db
      .connection()
      .query(
        `INSERT INTO users (id, username, password_hash, role, created_at, password_updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, username, passwordHash, role, createdAt, createdAt);

    return {
      id,
      username,
      passwordHash,
      role,
      createdAt,
      passwordUpdatedAt: createdAt,
    };
  }

  findByUsername(username: string): UserRecord | null {
    const row = this.db
      .connection()
      .query<UserRow, [string]>("SELECT * FROM users WHERE username = ?")
      .get(username);
    return row ? mapUser(row) : null;
  }

  findById(id: string): UserRecord | null {
    const row = this.db
      .connection()
      .query<UserRow, [string]>("SELECT * FROM users WHERE id = ?")
      .get(id);
    return row ? mapUser(row) : null;
  }

  async verifyCredentials(username: string, password: string): Promise<UserRecord | null> {
    const user = this.findByUsername(username);
    if (!user) {
      return null;
    }
    const valid = await verifyPassword(password, user.passwordHash);
    return valid ? user : null;
  }

  async updatePassword(
    userId: string,
    currentPassword: string,
    nextPassword: string,
  ): Promise<UserRecord> {
    assertPasswordStrength(nextPassword);
    const user = this.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    const currentOk = await verifyPassword(currentPassword, user.passwordHash);
    if (!currentOk) {
      throw new Error("Current password is incorrect");
    }
    const passwordHash = await hashPassword(nextPassword);
    const passwordUpdatedAt = nowIso();
    this.db
      .connection()
      .query(
        "UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?",
      )
      .run(passwordHash, passwordUpdatedAt, userId);

    const updated = this.findById(userId);
    if (!updated) {
      throw new Error("User not found");
    }
    return updated;
  }

  getSessionSecret(getSecret: (name: string) => string | null, setSecret: (name: string, value: string) => void): string {
    const existing = getSecret(SESSION_SECRET_NAME);
    if (existing) {
      return existing;
    }
    const secret = randomBytes(32).toString("base64url");
    setSecret(SESSION_SECRET_NAME, secret);
    return secret;
  }

  createSessionToken(userId: string, secret: string): string {
    const now = Date.now();
    return buildSessionToken(
      { userId, expiresAt: now + SESSION_TTL_MS, issuedAt: now },
      secret,
    );
  }

  /**
   * Verifies the HMAC cookie and rejects sessions issued before the user's
   * last password change.
   */
  verifySessionToken(token: string, secret: string): { userId: string } | null {
    const payload = parseSessionToken(token, secret);
    if (!payload) {
      return null;
    }
    const user = this.findById(payload.userId);
    if (!user) {
      return null;
    }
    const passwordUpdatedMs = Date.parse(user.passwordUpdatedAt);
    if (Number.isFinite(passwordUpdatedMs) && payload.issuedAt < passwordUpdatedMs) {
      return null;
    }
    return { userId: payload.userId };
  }

  findFirstAdmin(): UserRecord | null {
    const row = this.db
      .connection()
      .query<UserRow, []>(
        "SELECT * FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1",
      )
      .get();
    return row ? mapUser(row) : null;
  }

  createApiTokenForUser(
    userId: string,
    name: string,
    options?: { expiresAt?: string | null; scopes?: string[] },
  ): { record: ApiTokenRecord; token: string } {
    const { token, hash } = createApiToken();
    const id = ulid();
    const createdAt = nowIso();
    const expiresAt = options?.expiresAt === undefined ? null : options.expiresAt;
    const scopesJson = JSON.stringify(options?.scopes ?? []);

    this.db
      .connection()
      .query(
        `INSERT INTO api_tokens (id, user_id, token_hash, name, scopes_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, hash, name, scopesJson, createdAt, expiresAt);

    return {
      token,
      record: {
        id,
        userId,
        tokenHash: hash,
        name,
        scopesJson,
        createdAt,
        expiresAt,
      },
    };
  }

  verifyApiToken(token: string): UserRecord | null {
    return this.verifyApiTokenDetails(token)?.user ?? null;
  }

  verifyApiTokenDetails(
    token: string,
  ): { user: UserRecord; token: ApiTokenRecord; scopes: string[] } | null {
    if (!token.startsWith("gojo_")) {
      return null;
    }

    const hash = hashToken(token);
    const row = this.db
      .connection()
      .query<ApiTokenRow, [string]>("SELECT * FROM api_tokens WHERE token_hash = ?")
      .get(hash);

    if (!row) {
      return null;
    }

    if (!verifyToken(token, row.token_hash)) {
      return null;
    }

    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return null;
    }

    const user = this.findById(row.user_id);
    if (!user) return null;
    let scopes: string[] = [];
    try {
      const parsed = JSON.parse(row.scopes_json) as unknown;
      if (Array.isArray(parsed)) {
        scopes = parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      scopes = [];
    }
    return {
      user,
      token: {
        id: row.id,
        userId: row.user_id,
        tokenHash: row.token_hash,
        name: row.name,
        scopesJson: row.scopes_json,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      },
      scopes,
    };
  }

  listApiTokens(userId: string): ApiTokenRecord[] {
    const rows = this.db
      .connection()
      .query<ApiTokenRow, [string]>(
        "SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC",
      )
      .all(userId);

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      name: row.name,
      scopesJson: row.scopes_json,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  }

  /** Delete tokens whose expires_at is in the past. Returns rows removed. */
  purgeExpiredApiTokens(now = new Date()): number {
    const result = this.db
      .connection()
      .query(
        "DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at < ?",
      )
      .run(now.toISOString());
    return result.changes;
  }

  revokeApiToken(userId: string, tokenId: string): boolean {
    const result = this.db
      .connection()
      .query("DELETE FROM api_tokens WHERE id = ? AND user_id = ?")
      .run(tokenId, userId);
    return result.changes > 0;
  }
}
