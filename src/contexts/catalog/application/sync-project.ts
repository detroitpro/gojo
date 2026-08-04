import {
  domainEvent,
  ok,
  type Clock,
  type DomainEvent,
  type Result,
  type UnitOfWork,
} from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import { PROJECT_SYNCED_TOPICS } from "../domain/events";
import type { CatalogStore } from "../ports/catalog-store";
import type { ProjectSyncResult } from "./project-sync";
import type { ProjectDetailRow } from "../ports/catalog-store";

export type SyncProjectDeps = {
  store: CatalogStore;
  clock: Clock;
  uow: UnitOfWork;
};

export type SyncProjectInput = {
  projectId: string;
};

export type SyncProjectOutput = {
  project: ProjectDetailRow | null;
  sync: ProjectSyncResult;
  events: readonly DomainEvent[];
};

/**
 * Sync a project's manifest and re-attach its default repository source.
 * Emits `catalog.project.synced` exactly once so callers can rely on a single
 * platform event even when both API and CLI invoke this command.
 */
export async function syncProjectCommand(
  deps: SyncProjectDeps,
  input: SyncProjectInput,
): Promise<Result<SyncProjectOutput, UseCaseFailure>> {
  const project = deps.store.findProject(input.projectId);
  if (!project) {
    return useCaseFailure("not_found", "Project not found", 404);
  }

  const sync = deps.store.syncProjectFromManifest(project);
  try {
    deps.store.ensureProjectRepositorySource(project.id);
  } catch {
    // Repository discovery is best-effort; source health surfaces failures.
  }

  const refreshed = deps.store.findProject(project.id);

  const event = domainEvent(
    {
      type: "project.synced",
      entityKind: "project",
      entityId: project.id,
      projectId: project.id,
      topics: [...PROJECT_SYNCED_TOPICS],
      data: sync as unknown as Record<string, unknown>,
    },
    deps.clock.nowIso(),
  );
  deps.uow.addEvent(event);

  return ok({
    project: refreshed ? deps.store.toProjectDetail(refreshed) : null,
    sync,
    events: deps.uow.events(),
  });
}
