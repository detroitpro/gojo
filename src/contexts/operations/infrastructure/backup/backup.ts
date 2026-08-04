import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { $ } from "bun";

import type { GojoPaths } from "@/platform/config/paths";
import { Database } from "@/infrastructure/persistence";

const BACKUP_VERSION = 1;
const MANIFEST_NAME = "manifest.json";

function normalizeArchiveEntry(entry: string): string {
  return entry.replace(/^\.\//, "").replace(/\/$/, "");
}

function archiveEntries(listing: string): string[] {
  return listing
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(normalizeArchiveEntry)
    .filter((entry) => entry.length > 0 && !entry.endsWith("/"));
}

export interface BackupManifest {
  version: number;
  createdAt: string;
  files: string[];
}

function checkpointDatabase(dbPath: string): void {
  if (!existsSync(dbPath)) {
    return;
  }
  const db = Database.open(dbPath);
  db.connection().exec("PRAGMA wal_checkpoint(FULL);");
  db.close();
}

export async function createBackup(
  paths: GojoPaths,
  dbPath: string,
  destPath: string,
): Promise<{ path: string }> {
  const stagingDir = join(dirname(destPath), `.staging-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });

  const manifest: BackupManifest = {
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    files: [],
  };

  const copyIfExists = (source: string, relativeDest: string): void => {
    if (!existsSync(source)) {
      return;
    }
    const target = join(stagingDir, relativeDest);
    mkdirSync(dirname(target), { recursive: true });
    Bun.write(target, Bun.file(source));
    manifest.files.push(relativeDest);
  };

  copyIfExists(join(paths.config, "instance.yaml"), "config/instance.yaml");
  copyIfExists(join(paths.secrets, "master.key"), "secrets/master.key");
  checkpointDatabase(dbPath);
  copyIfExists(dbPath, "data/gojo.db");

  writeFileSync(join(stagingDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2), "utf8");

  mkdirSync(dirname(destPath), { recursive: true });
  await $`tar -czf ${destPath} -C ${stagingDir} .`.quiet();
  await $`rm -rf ${stagingDir}`.quiet();

  return { path: destPath };
}

export async function verifyBackup(path: string): Promise<boolean> {
  if (!existsSync(path)) {
    return false;
  }

  const listing = await $`tar -tzf ${path}`.nothrow();
  if (listing.exitCode !== 0) {
    return false;
  }

  const entries = archiveEntries(listing.stdout.toString());
  if (!entries.includes(MANIFEST_NAME)) {
    return false;
  }

  const manifestText = await $`tar -xOf ${path} ./${MANIFEST_NAME}`.nothrow();
  if (manifestText.exitCode !== 0) {
    return false;
  }

  try {
    const manifest = JSON.parse(manifestText.stdout.toString()) as BackupManifest;
    if (manifest.version !== BACKUP_VERSION || !Array.isArray(manifest.files)) {
      return false;
    }
    for (const file of manifest.files) {
      if (!entries.includes(file)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function restoreBackup(path: string, destHome: string): Promise<void> {
  const valid = await verifyBackup(path);
  if (!valid) {
    throw new Error(`Invalid backup archive: ${path}`);
  }

  const extractDir = join(dirname(path), `.restore-${Date.now()}`);
  mkdirSync(extractDir, { recursive: true });
  await $`tar -xzf ${path} -C ${extractDir}`.quiet();

  const manifestPath = join(extractDir, MANIFEST_NAME);
  if (!existsSync(manifestPath)) {
    throw new Error(`Backup manifest missing in archive: ${path}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;

  for (const relativePath of manifest.files) {
    const source = join(extractDir, relativePath);
    const target = join(destHome, relativePath);
    if (!existsSync(source)) {
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    Bun.write(target, Bun.file(source));
    if (basename(relativePath) === "master.key") {
      await $`chmod 600 ${target}`.quiet();
    }
  }

  await $`rm -rf ${extractDir}`.quiet();
}
