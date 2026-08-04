import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listBackups, resolveBackupPath } from "@/contexts/operations/infrastructure/backup/list";
import { resolvePaths } from "@/platform/config/paths";

describe("backup/list", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("listBackups returns backup archives under data", () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-backup-list-"));
    const paths = resolvePaths(tempDir);
    mkdirSync(paths.data, { recursive: true });
    writeFileSync(join(paths.data, "backup-1.tar.gz"), "x");
    writeFileSync(join(paths.data, "other.txt"), "y");

    const listed = listBackups(paths);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("backup-1.tar.gz");
  });

  test("resolveBackupPath rejects path traversal", () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-backup-safe-"));
    const paths = resolvePaths(tempDir);
    mkdirSync(paths.data, { recursive: true });

    expect(() => resolveBackupPath(paths, "/etc/passwd")).toThrow(
      /under the Gojo data directory/,
    );
    expect(() => resolveBackupPath(paths, join(paths.data, "../secrets/master.key"))).toThrow();
  });

  test("resolveBackupPath accepts backup under data", () => {
    tempDir = mkdtempSync(join(tmpdir(), "gojo-backup-ok-"));
    const paths = resolvePaths(tempDir);
    mkdirSync(paths.data, { recursive: true });
    const archive = join(paths.data, "backup-ok.tar.gz");
    writeFileSync(archive, "x");

    expect(resolveBackupPath(paths, archive)).toBe(archive);
  });
});
