import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { saveInstanceConfig } from "@/config/instance";
import { resolvePaths } from "@/config/paths";
import { Database } from "@/storage";
import { createBackup, restoreBackup, verifyBackup } from "@/backup/backup";

describe("backup/backup", () => {
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

  function setupHome(): { paths: ReturnType<typeof resolvePaths>; dbPath: string } {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-backup-test-"));
    const paths = resolvePaths(tempDir);
    mkdirSync(paths.config, { recursive: true });
    mkdirSync(paths.data, { recursive: true });
    const dbPath = paths.db;
    db = Database.open(dbPath);
    db.migrate();
    saveInstanceConfig(join(paths.config, "instance.yaml"), {
      bindHost: "127.0.0.1",
      bindPort: 7430,
      dataDir: paths.data,
      paused: false,
      telemetryEnabled: true,
      publicBaseUrl: null,
      trustedProxies: [],
      allowedOrigins: [],
      ipAllowlist: [],
      cookieSecure: "auto",
    });
    return { paths, dbPath };
  }

  test("createBackup packages config, secrets, and database", async () => {
    const { paths, dbPath } = setupHome();
    const storePaths = resolvePaths(tempDir!);
    const { SecretStore } = await import("@/secrets/store");
    const store = new SecretStore(db!, storePaths);
    store.set("backup-secret", "keep-me");
    db!.close();
    db = null;

    const archivePath = join(tempDir!, "backup.tar.gz");
    const result = await createBackup(paths, dbPath, archivePath);

    expect(result.path).toBe(archivePath);
    expect(existsSync(archivePath)).toBe(true);
    expect(await verifyBackup(archivePath)).toBe(true);
  });

  test("restoreBackup restores into destination home", async () => {
    const { paths, dbPath } = setupHome();
    const store = new (await import("@/secrets/store")).SecretStore(db!, paths);
    store.set("restore-secret", "restored-value");
    db!.close();
    db = null;

    const archivePath = join(tempDir!, "backup.tar.gz");
    await createBackup(paths, dbPath, archivePath);

    const restoreHome = join(tempDir!, "restored");
    await restoreBackup(archivePath, restoreHome);

    expect(existsSync(join(restoreHome, "config", "instance.yaml"))).toBe(true);
    expect(existsSync(join(restoreHome, "secrets", "master.key"))).toBe(true);
    expect(existsSync(join(restoreHome, "data", "gojo.db"))).toBe(true);

    const restoredDb = Database.open(join(restoreHome, "data", "gojo.db"));
    const restoredStore = new (await import("@/secrets/store")).SecretStore(
      restoredDb,
      resolvePaths(restoreHome),
    );
    expect(restoredStore.get("restore-secret")).toBe("restored-value");
    restoredDb.close();
  });

  test("verifyBackup rejects invalid archives", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-backup-test-"));
    const badArchive = join(tempDir, "bad.tar.gz");
    writeFileSync(badArchive, "not a tar");
    expect(await verifyBackup(badArchive)).toBe(false);
  });
});
