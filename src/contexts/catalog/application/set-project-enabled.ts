import {
  domainEvent,
  ok,
  type Clock,
  type DomainEvent,
  type Result,
  type UnitOfWork,
} from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";
import type { Project } from "@/infrastructure/persistence/types";

import { PROJECT_UPDATED_TOPICS } from "../domain/events";
import type { CatalogStore } from "../ports/catalog-store";

export type SetProjectEnabledDeps = {
  store: CatalogStore;
  clock: Clock;
  uow: UnitOfWork;
};

export type SetProjectEnabledInput = {
  id: string;
  enabled: boolean;
};

export type SetProjectEnabledOutput = {
  project: Project;
  events: readonly DomainEvent[];
};

export async function setProjectEnabledCommand(
  deps: SetProjectEnabledDeps,
  input: SetProjectEnabledInput,
): Promise<Result<SetProjectEnabledOutput, UseCaseFailure>> {
  const existing = deps.store.findProject(input.id);
  if (!existing) {
    return useCaseFailure("not_found", "Project not found", 404);
  }
  const updated = deps.store.updateProjectEnabled(input.id, input.enabled);
  if (!updated) {
    return useCaseFailure("not_found", "Project not found", 404);
  }
  deps.uow.addEvent(
    domainEvent(
      {
        type: "project.updated",
        entityKind: "project",
        entityId: updated.id,
        projectId: updated.id,
        topics: [...PROJECT_UPDATED_TOPICS],
        data: { enabled: input.enabled },
      },
      deps.clock.nowIso(),
    ),
  );
  return ok({ project: updated, events: deps.uow.events() });
}
