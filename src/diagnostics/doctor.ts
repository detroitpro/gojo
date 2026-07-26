import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { listAdapters } from "@/agents";
import type { AppContext } from "@/app/context";
import {
  inspectRunningBinary,
  type RunningBinaryStatus,
} from "@/diagnostics/binary-stale";
import { execGit } from "@/git/git";
import type { Repositories } from "@/storage";
import type { Project, Task } from "@/storage/types";

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
  task: string;
  step: string;
  binary: string;
  found: boolean;
  path?: string;
}

export interface ProjectDoctorResult {
  projectId: string;
  repoExists: boolean;
  manifest: boolean;
  baseCheckout: ProjectBaseCheckout;
  validationTools: ProjectValidationToolCheck[];
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

export function validationToolsForTasks(
  tasks: Task[],
  repoPath: string,
): ProjectValidationToolCheck[] {
  const out: ProjectValidationToolCheck[] = [];
  for (const task of tasks) {
    if (!task.enabled) {
      continue;
    }
    for (const step of parseValidationSteps(task.validationProfileJson)) {
      const binary = firstCommandToken(step.command);
      const resolved = resolveTool(binary, repoPath);
      out.push({
        task: task.name,
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

  const tasks = repos?.tasks.listByProject(project.id) ?? [];
  const validationTools = repoExists
    ? validationToolsForTasks(tasks, project.repoPath)
    : [];

  return {
    projectId: project.id,
    repoExists,
    manifest,
    baseCheckout,
    validationTools,
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
  };
}
