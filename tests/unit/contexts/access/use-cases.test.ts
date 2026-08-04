import { describe, expect, test } from "bun:test";

import type { ApiTokenRecord, UserRecord } from "@/contexts/access/infrastructure/auth/users";
import { createApiTokenCommand } from "@/contexts/access/application/create-api-token";
import { getMeQuery } from "@/contexts/access/application/get-me";
import { listApiTokensQuery } from "@/contexts/access/application/list-api-tokens";
import { revokeApiTokenCommand } from "@/contexts/access/application/revoke-api-token";
import type { UserServicePort } from "@/contexts/access/ports/user-service";

class MemoryUserService implements UserServicePort {
  private users = new Map<string, UserRecord>();
  private tokens = new Map<string, ApiTokenRecord[]>();
  private counter = 0;

  seedUser(user: UserRecord) {
    this.users.set(user.id, user);
    if (!this.tokens.has(user.id)) this.tokens.set(user.id, []);
    return user;
  }

  seedToken(userId: string, record: ApiTokenRecord) {
    const list = this.tokens.get(userId) ?? [];
    list.push(record);
    this.tokens.set(userId, list);
    return record;
  }

  findById(id: string): UserRecord | null {
    return this.users.get(id) ?? null;
  }

  listApiTokens(userId: string): ApiTokenRecord[] {
    return [...(this.tokens.get(userId) ?? [])];
  }

  createApiTokenForUser(
    userId: string,
    name: string,
    options?: { expiresAt?: string | null; scopes?: string[] },
  ): { record: ApiTokenRecord; token: string } {
    this.counter += 1;
    const record: ApiTokenRecord = {
      id: `tok_${this.counter}`,
      userId,
      tokenHash: `hash_${this.counter}`,
      name,
      scopesJson: JSON.stringify(options?.scopes ?? []),
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: options?.expiresAt ?? null,
    };
    const list = this.tokens.get(userId) ?? [];
    list.push(record);
    this.tokens.set(userId, list);
    return { record, token: `raw_${this.counter}` };
  }

  revokeApiToken(userId: string, tokenId: string): boolean {
    const list = this.tokens.get(userId) ?? [];
    const next = list.filter((row) => row.id !== tokenId);
    const changed = next.length !== list.length;
    if (changed) this.tokens.set(userId, next);
    return changed;
  }
}

const admin: UserRecord = {
  id: "usr_1",
  username: "admin",
  passwordHash: "hash",
  role: "admin",
  createdAt: "2026-01-01T00:00:00.000Z",
  passwordUpdatedAt: "2026-01-01T00:00:00.000Z",
};

const token = (over: Partial<ApiTokenRecord> = {}): ApiTokenRecord => ({
  id: "tok_seed",
  userId: admin.id,
  tokenHash: "seedhash",
  name: "seed",
  scopesJson: "[]",
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
  ...over,
});

const bootUsers = () => {
  const users = new MemoryUserService();
  users.seedUser(admin);
  return users;
};

describe("contexts/access get-me", () => {
  test("returns public projection for a known user", async () => {
    const users = bootUsers();
    const res = await getMeQuery({ users }, { userId: admin.id });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.user).toEqual({
        id: admin.id,
        username: admin.username,
        role: admin.role,
        createdAt: admin.createdAt,
      });
    }
  });

  test("returns unauthorized failure when user missing", async () => {
    const users = bootUsers();
    const res = await getMeQuery({ users }, { userId: "missing" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("unauthorized");
      expect(res.error.status).toBe(401);
    }
  });
});

describe("contexts/access list-api-tokens", () => {
  const listInput = (over: Partial<Parameters<typeof listApiTokensQuery>[1]> = {}) => ({
    userId: admin.id,
    page: { limit: 20, offset: 0 },
    sort: "createdAt" as const,
    order: "desc" as const,
    q: "",
    includeAgent: false,
    ...over,
  });

  test("filters agent-run tokens by default and includes them when asked", async () => {
    const users = bootUsers();
    users.seedToken(admin.id, token({ id: "tok_a", name: "personal" }));
    users.seedToken(admin.id, token({ id: "tok_b", name: "agent-run-x" }));

    const filtered = await listApiTokensQuery({ users }, listInput());
    expect(filtered.ok).toBe(true);
    if (filtered.ok) {
      expect(filtered.value.total).toBe(1);
      expect(filtered.value.tokens.map((t) => t.name)).toEqual(["personal"]);
    }

    const full = await listApiTokensQuery({ users }, listInput({ includeAgent: true }));
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(full.value.total).toBe(2);
    }
  });

  test("sorts by name asc and matches q substring", async () => {
    const users = bootUsers();
    users.seedToken(admin.id, token({ id: "tok_a", name: "alpha" }));
    users.seedToken(admin.id, token({ id: "tok_c", name: "charlie" }));
    users.seedToken(admin.id, token({ id: "tok_b", name: "bravo" }));

    const sorted = await listApiTokensQuery(
      { users },
      listInput({ sort: "name", order: "asc" }),
    );
    expect(sorted.ok).toBe(true);
    if (sorted.ok) {
      expect(sorted.value.tokens.map((t) => t.name)).toEqual(["alpha", "bravo", "charlie"]);
    }

    const searched = await listApiTokensQuery({ users }, listInput({ q: "bra" }));
    expect(searched.ok).toBe(true);
    if (searched.ok) {
      expect(searched.value.tokens.map((t) => t.name)).toEqual(["bravo"]);
    }
  });
});

describe("contexts/access create-api-token", () => {
  test("rejects blank names", async () => {
    const users = bootUsers();
    const res = await createApiTokenCommand({ users }, { userId: admin.id, name: "  " });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("validation_error");
      expect(res.error.status).toBe(400);
    }
  });

  test("rejects invalid expiresAt", async () => {
    const users = bootUsers();
    const res = await createApiTokenCommand(
      { users },
      { userId: admin.id, name: "ci", expiresAt: "not-a-date" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("validation_error");
    }
  });

  test("creates a token and returns raw value once", async () => {
    const users = bootUsers();
    const res = await createApiTokenCommand(
      { users },
      { userId: admin.id, name: "ci", scopes: ["scheduling:read"] },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.name).toBe("ci");
      expect(res.value.token).toMatch(/^raw_/);
      expect(res.value.scopes).toEqual(["scheduling:read"]);
    }
    expect(users.listApiTokens(admin.id)).toHaveLength(1);
  });
});

describe("contexts/access revoke-api-token", () => {
  test("returns not_found when the token does not exist", async () => {
    const users = bootUsers();
    const res = await revokeApiTokenCommand(
      { users },
      { userId: admin.id, tokenId: "tok_missing" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("not_found");
      expect(res.error.status).toBe(404);
    }
  });

  test("returns validation_error when tokenId is empty", async () => {
    const users = bootUsers();
    const res = await revokeApiTokenCommand(
      { users },
      { userId: admin.id, tokenId: "" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("validation_error");
    }
  });

  test("removes an existing token", async () => {
    const users = bootUsers();
    users.seedToken(admin.id, token({ id: "tok_del", name: "old" }));
    const res = await revokeApiTokenCommand(
      { users },
      { userId: admin.id, tokenId: "tok_del" },
    );
    expect(res.ok).toBe(true);
    expect(users.listApiTokens(admin.id)).toHaveLength(0);
  });
});
