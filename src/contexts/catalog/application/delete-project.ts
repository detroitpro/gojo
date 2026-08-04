import {
  domainEvent,
  ok,
  type Clock,
  type DomainEvent,
  type Result,
  type UnitOfWork,
} from "@/kernel";

import { PROJECT_DELETED_TOPICS } from "../domain/events";
import type { CatalogStore } from "../ports/catalog-store";

export type DeleteProjectDeps = {
  store: CatalogStore;
  clock: Clock;
  uow: UnitOfWork;
};

export type DeleteProjectInput = { id: string };

export type DeleteProjectOutput = {
  removed: boolean;
  events: readonly DomainEvent[];
};

export async function deleteProjectCommand(
  deps: DeleteProjectDeps,
  input: DeleteProjectInput,
): Promise<Result<DeleteProjectOutput>> {
  const removed = deps.store.deleteProject(input.id);
  if (removed) {
    deps.uow.addEvent(
      domainEvent(
        {
          type: "project.deleted",
          entityKind: "project",
          entityId: input.id,
          projectId: input.id,
          topics: [...PROJECT_DELETED_TOPICS],
        },
        deps.clock.nowIso(),
      ),
    );
  }
  return ok({ removed, events: deps.uow.events() });
}
