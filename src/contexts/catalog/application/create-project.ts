import { ok, type Result } from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";
import type { ProjectDetailRow } from "../ports/catalog-store";
import type { Project } from "@/infrastructure/persistence/types";

export type CreateProjectInput = {
  name: string;
  repoPath: string;
  defaultBranch?: string;
  remoteUrl?: string;
};

export type CreateProjectDeps = {
  createProject: (input: {
    name: string;
    repoPath: string;
    defaultBranch?: string;
    remoteUrl?: string;
  }) => Project;
  toProjectDetail: (project: Project) => ProjectDetailRow;
  ensureProjectRepositorySource: (projectId: string) => void;
  appendEvent: (event: {
    projectId: string;
    type: string;
    entityKind: string;
    entityId: string;
    topics: Array<
      | "dashboard"
      | "overview"
      | "impact"
      | "queue"
      | "runs"
      | "agents"
      | "schedules"
      | "projects"
      | "work"
      | "sources"
    >;
  }) => void;
};

export async function createProjectCommand(
  deps: CreateProjectDeps,
  input: CreateProjectInput,
): Promise<Result<{ project: ProjectDetailRow }, UseCaseFailure>> {
  if (!input.name?.trim() || !input.repoPath?.trim()) {
    return useCaseFailure(
      "validation_error",
      "name and repoPath are required",
      400,
    );
  }
  const project = deps.createProject({
    name: input.name,
    repoPath: input.repoPath,
    ...(input.defaultBranch ? { defaultBranch: input.defaultBranch } : {}),
    ...(input.remoteUrl !== undefined ? { remoteUrl: input.remoteUrl } : {}),
  });
  try {
    deps.ensureProjectRepositorySource(project.id);
  } catch {
    // Repository discovery is best-effort; source health exposes failures.
  }
  deps.appendEvent({
    projectId: project.id,
    type: "project.created",
    entityKind: "project",
    entityId: project.id,
    topics: ["dashboard", "overview", "projects", "sources"],
  });
  return ok({ project: deps.toProjectDetail(project) });
}
