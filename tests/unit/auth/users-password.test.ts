import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UserService } from "@/auth/users";
import { Database } from "@/storage";

describe("UserService password change", () => {
  function withUsers(fn: (users: UserService) => void | Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), "gojo-users-password-"));
    const db = Database.open(join(dir, "gojo.db"));
    db.migrate();
    const users = new UserService(db);
    return Promise.resolve(fn(users)).finally(() => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
  }

  test("createUser sets passwordUpdatedAt and listUsers omits hashes", async () => {
    await withUsers(async (users) => {
      const admin = await users.createUser("admin", "password-here", "admin");
      expect(admin.passwordUpdatedAt).toBe(admin.createdAt);

      const listed = users.listUsers();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toEqual({
        id: admin.id,
        username: "admin",
        role: "admin",
        createdAt: admin.createdAt,
      });
      expect("passwordHash" in listed[0]!).toBe(false);
    });
  });

  test("updatePassword rehashes and bumps passwordUpdatedAt", async () => {
    await withUsers(async (users) => {
      const admin = await users.createUser("admin", "password-here", "admin");
      const before = admin.passwordUpdatedAt;

      await Bun.sleep(5);
      const updated = await users.updatePassword(admin.id, "password-here", "new-password-99");
      expect(updated.passwordUpdatedAt > before).toBe(true);
      expect(await users.verifyCredentials("admin", "new-password-99")).not.toBeNull();
      expect(await users.verifyCredentials("admin", "password-here")).toBeNull();
    });
  });

  test("updatePassword rejects wrong current and weak next password", async () => {
    await withUsers(async (users) => {
      const admin = await users.createUser("admin", "password-here", "admin");

      await expect(users.updatePassword(admin.id, "wrong", "new-password-99")).rejects.toThrow(
        /current password/i,
      );
      await expect(users.updatePassword(admin.id, "password-here", "short")).rejects.toThrow(
        /at least 8/i,
      );
    });
  });

  test("session issued before password change is rejected", async () => {
    await withUsers(async (users) => {
      const admin = await users.createUser("admin", "password-here", "admin");
      const secret = "test-session-secret";
      const token = users.createSessionToken(admin.id, secret);
      expect(users.verifySessionToken(token, secret)?.userId).toBe(admin.id);

      await Bun.sleep(5);
      await users.updatePassword(admin.id, "password-here", "new-password-99");
      expect(users.verifySessionToken(token, secret)).toBeNull();

      const fresh = users.createSessionToken(admin.id, secret);
      expect(users.verifySessionToken(fresh, secret)?.userId).toBe(admin.id);
    });
  });
});
