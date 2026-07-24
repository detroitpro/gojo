import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LAYOUT_DIRS = [
  "config",
  "data",
  "repositories",
  "worktrees",
  "artifacts",
  "logs",
  "cache",
  "secrets",
  "updates",
] as const;

export interface GojoPaths {
  home: string;
  config: string;
  data: string;
  db: string;
  repositories: string;
  worktrees: string;
  artifacts: string;
  logs: string;
  cache: string;
  secrets: string;
  updates: string;
}

export function defaultHomeDir(): string {
  const fromEnv = process.env["GOJO_HOME"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return join(homedir(), ".gojo");
}

export function ensureLayout(home: string): void {
  for (const dir of LAYOUT_DIRS) {
    const path = join(home, dir);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }
}

export function resolvePaths(home?: string): GojoPaths {
  const resolvedHome = home ?? defaultHomeDir();
  return {
    home: resolvedHome,
    config: join(resolvedHome, "config"),
    data: join(resolvedHome, "data"),
    db: join(resolvedHome, "data", "gojo.db"),
    repositories: join(resolvedHome, "repositories"),
    worktrees: join(resolvedHome, "worktrees"),
    artifacts: join(resolvedHome, "artifacts"),
    logs: join(resolvedHome, "logs"),
    cache: join(resolvedHome, "cache"),
    secrets: join(resolvedHome, "secrets"),
    updates: join(resolvedHome, "updates"),
  };
}
