import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UserService } from "@/auth/users";
import { Database } from "@/storage";

describe("UserService api tokens", () => {
  function withUsers(fn: (users: UserService, db: Database) => void | Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), "gojo-users-tokens-"));
    const db = Database.open(join(dir, "gojo.db"));
    db.migrate();
    const users = new UserService(db);
    return Promise.resolve(fn(users, db)).finally(() => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
  }

  test("purgeExpiredApiTokens removes only expired rows", async () => {
    await withUsers(async (users) => {
      const admin = await users.createUser("admin", "password-here", "admin");
      const keep = users.createApiTokenForUser(admin.id, "keep", {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const gone = users.createApiTokenForUser(admin.id, "agent-run-old", {
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      });
      users.createApiTokenForUser(admin.id, "forever");

      const removed = users.purgeExpiredApiTokens();
      expect(removed).toBe(1);

      const remaining = users.listApiTokens(admin.id).map((t) => t.id);
      expect(remaining).toContain(keep.record.id);
      expect(remaining).not.toContain(gone.record.id);
      expect(remaining).toHaveLength(2);
    });
  });

  test("revokeApiToken deletes by id", async () => {
    await withUsers(async (users) => {
      const admin = await users.createUser("admin", "password-here", "admin");
      const created = users.createApiTokenForUser(admin.id, "agent-run-x");
      expect(users.revokeApiToken(admin.id, created.record.id)).toBe(true);
      expect(users.listApiTokens(admin.id)).toHaveLength(0);
    });
  });
});
