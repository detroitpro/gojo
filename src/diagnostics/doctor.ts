import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { listAdapters } from "@/agents";
import type { AppContext } from "@/app/context";
import {
  expandTrustedProxies,
  isLoopbackHost,
  resolveApiBaseUrl,
  type CookieSecureMode,
} from "@/config/instance";
import {
  inspectRunningBinary,
  type RunningBinaryStatus,
} from "@/diagnostics/binary-stale";
import { execGit } from "@/git/git";
import type { Repositories } from "@/storage";
import type { Agent, Project } from "@/storage/types";
import {
  GENERATED_WORKSPACE_PATHS,
  gojoGitignoreBlock,
  REGISTRATION_PATHS,
} from "@shared/workspace-files";

export interface DoctorToolCheck {
  name: string;
  found: boolean;
  path?: string;
}

export interface ProjectBaseCheckout {
  clean: boolean;
  dirtyFiles: string[];
  behindOrigin: number | null;
}

export interface ProjectValidationToolCheck {
  agent: string;
  step: string;
  binary: string;
  found: boolean;
  path?: string;
  /** True when the step only uses shell builtins (available via `sh -c`). */
  shellBuiltin?: boolean;
}

/**
 * Whether the repo honours the `.gojo/` workspace contract: generated run
 * files ignored, registration files tracked.
 */
export interface ProjectWorkspaceFilesCheck {
  /** Generated paths committed to the repo — they cause cross-PR conflicts. */
  trackedGeneratedFiles: string[];
  /** Generated paths that `.gitignore` does not cover. */
  unignoredGeneratedFiles: string[];
  /** Registration paths that exist on disk but are not tracked. */
  untrackedRegistrationFiles: string[];
  /** Suggested `.gitignore` block when anything above is non-empty. */
  suggestedGitignore: string | null;
}

export interface ProjectDoctorResult {
  projectId: string;
  repoExists: boolean;
  manifest: boolean;
  baseCheckout: ProjectBaseCheckout;
  validationTools: ProjectValidationToolCheck[];
  workspaceFiles: ProjectWorkspaceFilesCheck;
}

export interface InstanceNetworkDoctor {
  bindHost: string;
  bindPort: number;
  loopback: boolean;
  publicBaseUrl: string | null;
  publicBaseUrlScheme: "http" | "https" | null;
  trustedProxiesConfigured: boolean;
  trustedProxyCidrCount: number;
  cookieSecure: CookieSecureMode;
  apiBaseUrl: string | null;
  ipAllowlistConfigured: boolean;
}

export interface InstanceDoctorResult {
  git: boolean;
  disk: boolean;
  database: boolean;
  agents: Array<{
    name: string;
    installed: boolean;
    version?: string;
    authenticated?: boolean;
  }>;
  home: string;
  /** Daemon process PATH (validation inherits this). */
  daemonPath: string;
  /** Core tools resolved under the daemon env. */
  tools: DoctorToolCheck[];
  /** True when this process is running a replaced binary (restart needed). */
  binaryStale: boolean;
  binaryStatus: RunningBinaryStatus;
  /** Operator-facing warnings (stale binary, etc.). */
  warnings: string[];
  network: InstanceNetworkDoctor;
}

/** Core tools; `gh` and `tea` are optional PR CLIs (`integration.prTool`). */
const INSTANCE_TOOLS = ["git", "bun", "gh", "tea", "sh"] as const;

/** First token of a shell command (validation steps run via `sh -c`). */
export function firstCommandToken(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.split(/\s+/)[0] ?? "";
}

/** Shell builtins always available when validation runs via `sh -c` — not PATH binaries. */
const SHELL_BUILTINS = new Set([
  "cd",
  "test",
  "[",
  "true",
  "false",
  "echo",
  "printf",
  ":",
  ".",
  "source",
  "export",
  "unset",
  "set",
  "shift",
  "pwd",
  "read",
  "exit",
  "return",
  "eval",
  "exec",
  "command",
  "builtin",
  "local",
  "declare",
  "typeset",
  "readonly",
  "wait",
  "trap",
]);

/**
 * Pick the external tool a validation step needs.
 * Skips preamble builtins so `cd backend && yarn lint` checks `yarn`, not `cd`.
 */
export function primaryValidationTool(command: string): {
  binary: string;
  shellBuiltin: boolean;
} {
  const segments = command.split(/(?:&&|\|\||;|\|)/);
  for (const segment of segments) {
    const token = firstCommandToken(segment);
    if (!token) {
      continue;
    }
    if (SHELL_BUILTINS.has(token)) {
      continue;
    }
    return { binary: token, shellBuiltin: false };
  }
  const only = firstCommandToken(command);
  return { binary: only || "sh", shellBuiltin: true };
}

/** Resolve a binary under the current process env (daemon PATH). */
export function resolveTool(name: string, cwd?: string): DoctorToolCheck {
  if (!name) {
    return { name: "", found: false };
  }
  if (name.includes("/") || name.startsWith(".")) {
    const abs = cwd
      ? isAbsolute(name)
        ? name
        : resolve(cwd, name)
      : resolve(name);
    return existsSync(abs)
      ? { name, found: true, path: abs }
      : { name, found: false };
  }
  const path = Bun.which(name) ?? undefined;
  return path ? { name, found: true, path } : { name, found: false };
}

function parseValidationSteps(
  json: string,
): Array<{ name: string; command: string }> {
  try {
    const parsed = JSON.parse(json) as { steps?: unknown };
    if (!Array.isArray(parsed.steps)) {
      return [];
    }
    const steps: Array<{ name: string; command: string }> = [];
    for (const step of parsed.steps) {
      if (!step || typeof step !== "object") {
        continue;
      }
      const record = step as Record<string, unknown>;
      if (typeof record["name"] !== "string" || typeof record["command"] !== "string") {
        continue;
      }
      steps.push({ name: record["name"], command: record["command"] });
    }
    return steps;
  } catch {
    return [];
  }
}

export function validationToolsForAgents(
  agents: Agent[],
  repoPath: string,
): ProjectValidationToolCheck[] {
  const out: ProjectValidationToolCheck[] = [];
  for (const agent of agents) {
    if (!agent.enabled) {
      continue;
    }
    for (const step of parseValidationSteps(agent.validationProfileJson)) {
      const { binary, shellBuiltin } = primaryValidationTool(step.command);
      if (shellBuiltin) {
        out.push({
          agent: agent.name,
          step: step.name,
          binary,
          found: true,
          shellBuiltin: true,
        });
        continue;
      }
      const resolved = resolveTool(binary, repoPath);
      out.push({
        agent: agent.name,
        step: step.name,
        binary,
        found: resolved.found,
        ...(resolved.path ? { path: resolved.path } : {}),
      });
    }
  }
  return out;
}

async function inspectBaseCheckout(
  repoPath: string,
  defaultBranch: string,
): Promise<ProjectBaseCheckout> {
  const status = await execGit(repoPath, ["status", "--porcelain"]);
  const dirtyFiles =
    status.exitCode === 0
      ? status.stdout
          .split("\n")
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0)
          .map((line) => line.slice(3).trim() || line)
      : [];

  let behindOrigin: number | null = null;
  const remote = await execGit(repoPath, [
    "rev-parse",
    "--verify",
    `origin/${defaultBranch}`,
  ]);
  if (remote.exitCode === 0) {
    const count = await execGit(repoPath, [
      "rev-list",
      "--count",
      `${defaultBranch}..origin/${defaultBranch}`,
    ]);
    if (count.exitCode === 0) {
      const n = Number.parseInt(count.stdout, 10);
      behindOrigin = Number.isFinite(n) ? n : null;
    }
  }

  return {
    clean: dirtyFiles.length === 0,
    dirtyFiles,
    behindOrigin,
  };
}

const EMPTY_WORKSPACE_FILES: ProjectWorkspaceFilesCheck = {
  trackedGeneratedFiles: [],
  unignoredGeneratedFiles: [],
  untrackedRegistrationFiles: [],
  suggestedGitignore: null,
};

async function inspectWorkspaceFiles(
  repoPath: string,
): Promise<ProjectWorkspaceFilesCheck> {
  const trackedGeneratedFiles: string[] = [];
  const unignoredGeneratedFiles: string[] = [];

  for (const path of GENERATED_WORKSPACE_PATHS) {
    // Works for file and directory entries alike; a directory lists its files.
    const tracked = await execGit(repoPath, ["ls-files", "--", path]);
    if (tracked.exitCode === 0 && tracked.stdout.trim().length > 0) {
      trackedGeneratedFiles.push(path);
    }
    // check-ignore exits 0 only when the path is ignored.
    const ignored = await execGit(repoPath, ["check-ignore", "-q", path]);
    if (ignored.exitCode !== 0) {
      unignoredGeneratedFiles.push(path);
    }
  }

  const untrackedRegistrationFiles: string[] = [];
  for (const path of REGISTRATION_PATHS) {
    if (!existsSync(join(repoPath, path))) {
      continue;
    }
    const tracked = await execGit(repoPath, ["ls-files", path]);
    if (tracked.exitCode === 0 && tracked.stdout.trim().length === 0) {
      untrackedRegistrationFiles.push(path);
    }
  }

  const needsFix =
    trackedGeneratedFiles.length > 0 || unignoredGeneratedFiles.length > 0;

  return {
    trackedGeneratedFiles,
    unignoredGeneratedFiles,
    untrackedRegistrationFiles,
    suggestedGitignore: needsFix ? gojoGitignoreBlock() : null,
  };
}

export async function projectDoctor(
  project: Project,
  repos?: Repositories,
): Promise<ProjectDoctorResult> {
  const repoExists = existsSync(project.repoPath);
  const manifest =
    existsSync(join(project.repoPath, "gojo.yaml")) ||
    existsSync(join(project.repoPath, ".gojo", "project.yaml"));

  const baseCheckout = repoExists
    ? await inspectBaseCheckout(project.repoPath, project.defaultBranch)
    : { clean: false, dirtyFiles: [], behindOrigin: null };

  const agents = repos?.agents.listByProject(project.id) ?? [];
  const validationTools = repoExists
    ? validationToolsForAgents(agents, project.repoPath)
    : [];

  const workspaceFiles = repoExists
    ? await inspectWorkspaceFiles(project.repoPath)
    : EMPTY_WORKSPACE_FILES;

  return {
    projectId: project.id,
    repoExists,
    manifest,
    baseCheckout,
    validationTools,
    workspaceFiles,
  };
}

export async function instanceDoctor(ctx: AppContext): Promise<InstanceDoctorResult> {
  const git = (await Bun.spawn(["git", "--version"]).exited) === 0;
  const agents = await Promise.all(
    listAdapters().map(async (adapter) => ({
      name: adapter.name,
      ...(await adapter.detect()),
    })),
  );

  const tools = INSTANCE_TOOLS.map((name) => resolveTool(name));
  const binaryStatus = inspectRunningBinary();
  const warnings: string[] = [];
  if (binaryStatus.stale && binaryStatus.detail) {
    warnings.push(binaryStatus.detail);
  }

  const { instance } = ctx;
  let apiBaseUrl: string | null = null;
  try {
    apiBaseUrl = resolveApiBaseUrl(instance);
  } catch {
    apiBaseUrl = null;
  }
  let publicBaseUrlScheme: "http" | "https" | null = null;
  if (instance.publicBaseUrl) {
    try {
      const protocol = new URL(instance.publicBaseUrl).protocol;
      publicBaseUrlScheme = protocol === "https:" ? "https" : protocol === "http:" ? "http" : null;
    } catch {
      publicBaseUrlScheme = null;
    }
  }

  const network: InstanceNetworkDoctor = {
    bindHost: instance.bindHost,
    bindPort: instance.bindPort,
    loopback: isLoopbackHost(instance.bindHost),
    publicBaseUrl: instance.publicBaseUrl,
    publicBaseUrlScheme,
    trustedProxiesConfigured: instance.trustedProxies.length > 0,
    trustedProxyCidrCount: expandTrustedProxies(instance.trustedProxies).length,
    cookieSecure: instance.cookieSecure,
    apiBaseUrl,
    ipAllowlistConfigured: instance.ipAllowlist.length > 0,
  };

  if (!network.loopback && !instance.publicBaseUrl) {
    warnings.push(
      "bindHost is not loopback but publicBaseUrl is unset — set publicBaseUrl before exposing the daemon",
    );
  }
  if (publicBaseUrlScheme === "https" && instance.trustedProxies.length === 0) {
    warnings.push(
      "publicBaseUrl is https but trustedProxies is empty — Secure cookies and real client IPs will not honor X-Forwarded-* (add cloudflare or 127.0.0.1 for Tunnel)",
    );
  }
  if (!network.loopback && publicBaseUrlScheme === "http") {
    warnings.push(
      "LAN cleartext: publicBaseUrl uses http on a non-loopback bind — use only on a trusted network, or terminate TLS at Cloudflare",
    );
  }
  if (apiBaseUrl == null) {
    warnings.push(
      "apiBaseUrl cannot be resolved — agent progress callbacks will be disabled until publicBaseUrl is set",
    );
  }

  return {
    git,
    disk: existsSync(ctx.paths.data),
    database: ctx.db.hasExpectedTables(),
    agents,
    home: ctx.paths.home,
    daemonPath: process.env["PATH"] ?? "",
    tools,
    binaryStale: binaryStatus.stale,
    binaryStatus,
    warnings,
    network,
  };
}
