import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
  isGitRepo: boolean;
}

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

function safeRealPath(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Path does not exist: ${path}`);
  }
  return realpathSync(path);
}

/** Resolve a browse path; defaults to the operator home directory. */
export function resolveBrowsePath(requested?: string | null): string {
  const raw = requested && requested.trim().length > 0 ? requested.trim() : homedir();
  const absolute = resolve(raw);
  const real = safeRealPath(absolute);
  const stats = statSync(real);
  if (!stats.isDirectory()) {
    throw new Error(`Not a directory: ${real}`);
  }
  return real;
}

/** List directories (and optionally files) under a path for the UI picker. */
export function listDirectory(requested?: string | null): DirectoryListing {
  const path = resolveBrowsePath(requested);
  const parentDir = dirname(path);
  const parent = parentDir !== path ? parentDir : null;

  const names = readdirSync(path, { withFileTypes: true });
  const entries: DirectoryEntry[] = [];

  for (const dirent of names) {
    if (dirent.name.startsWith(".")) {
      continue;
    }

    const entryPath = join(path, dirent.name);
    let isDirectory = dirent.isDirectory();
    if (dirent.isSymbolicLink()) {
      try {
        isDirectory = statSync(entryPath).isDirectory();
      } catch {
        continue;
      }
    }

    if (!isDirectory) {
      continue;
    }

    entries.push({
      name: dirent.name,
      path: entryPath,
      isDirectory: true,
      isGitRepo: isGitRepo(entryPath),
    });
  }

  entries.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) {
      return a.isGitRepo ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    path,
    parent,
    entries,
    isGitRepo: isGitRepo(path),
  };
}

export function suggestProjectName(repoPath: string): string {
  const name = basename(repoPath.replace(/[/\\]+$/, ""));
  return name.length > 0 ? name : "project";
}

/** Roots offered as quick jumps in the picker. */
export function browseRoots(): Array<{ label: string; path: string }> {
  const home = homedir();
  const roots = [
    { label: "Home", path: home },
    { label: "Projects", path: join(home, "projects") },
    { label: "Root", path: sep === "\\" ? "C:\\" : "/" },
  ];

  return roots.filter((root) => {
    try {
      return existsSync(root.path) && statSync(root.path).isDirectory();
    } catch {
      return false;
    }
  });
}
