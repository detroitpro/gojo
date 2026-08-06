import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolvePaths } from "@/platform/config/paths";
import { createRepositories } from "@/platform/create-repositories";
import {
  Database
} from "@/infrastructure/persistence";
import { SecretStore } from "@/contexts/access/infrastructure/secrets/store";

describe("secrets/store", () => {
  let tempDir: string | null = null;
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function openStore(): SecretStore {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-secrets-test-"));
    const paths = resolvePaths(tempDir);
    db = Database.open(join(tempDir, "gojo.db"));
    db.migrate();
    return new SecretStore(db, paths);
  }

  test("generates master.key with mode 600", () => {
    const store = openStore();
    store.set("api-key", "secret-value");

    const keyPath = join(tempDir!, "secrets", "master.key");
    expect(existsSync(keyPath)).toBe(true);
    expect(readFileSync(keyPath).length).toBe(32);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
  });

  test("set/get/delete round-trip global secrets", () => {
    const store = openStore();
    store.set("token", "abc123");
    expect(store.get("token")).toBe("abc123");
    expect(store.delete("token")).toBe(true);
    expect(store.get("token")).toBeNull();
  });

  test("set overwrites an existing secret value", () => {
    const store = openStore();
    store.set("token", "first");
    store.set("token", "second");
    expect(store.get("token")).toBe("second");
  });

  test("repository deleteByName removes project-scoped secrets", () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-secrets-test-"));
    db = Database.open(join(tempDir, "gojo.db"));
    db.migrate();
    const repos = createRepositories(db);
    const project = repos.projects.create({ name: "demo", repoPath: "/tmp/demo" });

    repos.secrets.upsert({ name: "token", projectId: project.id, ciphertext: "cipher" });
    expect(repos.secrets.findByName("token", project.id)?.ciphertext).toBe("cipher");

    expect(repos.secrets.deleteByName("token", project.id)).toBe(true);
    expect(repos.secrets.findByName("token", project.id)).toBeNull();
    expect(repos.secrets.deleteByName("token", project.id)).toBe(false);
  });

  test("supports project-scoped secrets", () => {
    const store = openStore();
    const project = createRepositories(db!).projects.create({
      name: "demo",
      repoPath: "/tmp/demo",
    });

    store.set("token", "global");
    store.set("token", "project-specific", project.id);

    expect(store.get("token")).toBe("global");
    expect(store.get("token", project.id)).toBe("project-specific");
    expect(store.list()).toEqual([
      { name: "token", projectId: null },
      { name: "token", projectId: project.id },
    ]);
  });

  test("redact replaces secret values", () => {
    const store = openStore();
    const redacted = store.redact("prefix secret-value suffix", ["secret-value"]);
    expect(redacted).toBe("prefix *** suffix");
  });

  test("persists encrypted values in sqlite", () => {
    const store = openStore();
    store.set("db-password", "hunter2");

    const row = db!
      .connection()
      .query<{ ciphertext: string }, [string]>("SELECT ciphertext FROM secrets WHERE name = ?")
      .get("db-password");

    expect(row?.ciphertext).toBeDefined();
    expect(row?.ciphertext).not.toContain("hunter2");
  });

  test("reuses existing master.key", () => {
    const store = openStore();
    store.set("one", "value-one");

    const keyPath = join(tempDir!, "secrets", "master.key");
    const firstKey = readFileSync(keyPath);

    db?.close();
    db = Database.open(join(tempDir!, "gojo.db"));
    const reopened = new SecretStore(db, resolvePaths(tempDir!));

    expect(readFileSync(keyPath)).toEqual(firstKey);
    expect(reopened.get("one")).toBe("value-one");
  });
});
