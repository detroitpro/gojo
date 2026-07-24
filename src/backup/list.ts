import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import type { GojoPaths } from "@/config/paths";

export interface BackupListItem {
  path: string;
  name: string;
  size: number;
  createdAt: string;
}

export function listBackups(paths: GojoPaths): BackupListItem[] {
  if (!existsSync(paths.data)) {
    return [];
  }

  return readdirSync(paths.data)
    .filter((name) => name.startsWith("backup-") && name.endsWith(".tar.gz"))
    .map((name) => {
      const path = join(paths.data, name);
      const stat = statSync(path);
      return {
        path,
        name,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Resolve and ensure a backup path is under the Gojo data directory. */
export function resolveBackupPath(paths: GojoPaths, inputPath: string): string {
  const resolved = resolve(inputPath);
  const dataRoot = resolve(paths.data);

  let realResolved = resolved;
  let realData = dataRoot;
  try {
    if (existsSync(resolved)) {
      realResolved = realpathSync(resolved);
    }
    if (existsSync(dataRoot)) {
      realData = realpathSync(dataRoot);
    }
  } catch {
    throw new Error("Invalid backup path");
  }

  const prefix = realData.endsWith("/") ? realData : `${realData}/`;
  if (realResolved !== realData && !realResolved.startsWith(prefix)) {
    throw new Error("Backup path must be under the Gojo data directory");
  }

  const name = basename(realResolved);
  if (!name.startsWith("backup-") || !name.endsWith(".tar.gz")) {
    throw new Error("Backup path must be a backup-*.tar.gz archive");
  }

  return realResolved;
}

export function defaultBackupDest(paths: GojoPaths): string {
  return join(paths.data, `backup-${Date.now()}.tar.gz`);
}
