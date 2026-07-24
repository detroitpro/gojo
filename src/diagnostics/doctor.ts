import { existsSync } from "node:fs";
import { join } from "node:path";

import { listAdapters } from "@/agents";
import type { AppContext } from "@/app/context";
import type { Project } from "@/storage/types";

export interface ProjectDoctorResult {
  projectId: string;
  repoExists: boolean;
  manifest: boolean;
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
}

export function projectDoctor(project: Project): ProjectDoctorResult {
  return {
    projectId: project.id,
    repoExists: existsSync(project.repoPath),
    manifest:
      existsSync(join(project.repoPath, "gojo.yaml")) ||
      existsSync(join(project.repoPath, ".gojo", "project.yaml")),
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

  return {
    git,
    disk: existsSync(ctx.paths.data),
    database: ctx.db.hasExpectedTables(),
    agents,
    home: ctx.paths.home,
  };
}
