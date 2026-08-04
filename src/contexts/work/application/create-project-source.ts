import {
  domainEvent,
  ok,
  type Clock,
  type DomainEvent,
  type Result,
  type UnitOfWork,
} from "@/kernel";

import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";

import type {
  CreateProjectSourceCommand,
  CreateProjectSourceResult,
  WorkStore,
} from "../ports/work-store";

export type CreateProjectSourceDeps = {
  store: WorkStore;
  clock: Clock;
  uow: UnitOfWork;
};

export async function createProjectSourceCommand(
  deps: CreateProjectSourceDeps,
  input: CreateProjectSourceCommand,
): Promise<
  Result<CreateProjectSourceResult & { events: readonly DomainEvent[] }, UseCaseFailure>
> {
  if (!deps.store.projectExists(input.projectId)) {
    return useCaseFailure("not_found", "Project not found", 404);
  }
  if (
    !input.name ||
    !input.kind ||
    !input.externalKey ||
    deps.store.findAdapterType(input.adapter) === "unknown"
  ) {
    return useCaseFailure(
      "validation_error",
      "name, supported adapter, kind, and externalKey are required",
      400,
    );
  }
  try {
    const created = deps.store.createProjectSource(input);
    deps.uow.addEvent(
      domainEvent(
        {
          type: "source.attached",
          entityKind: "source",
          entityId: created.source.id,
          projectId: input.projectId,
          topics: ["dashboard", "projects", "work", "sources"],
        },
        deps.clock.nowIso(),
      ),
    );
    return ok({ ...created, events: deps.uow.events() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return useCaseFailure("validation_error", message, 400);
  }
}
