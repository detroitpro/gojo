import {
  domainEvent,
  ok,
  type Clock,
  type DomainEvent,
  type Result,
  type UnitOfWork,
} from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";
import type { Schedule } from "@/infrastructure/persistence/types";

import { SCHEDULE_UPDATED_TOPICS } from "../domain/events";
import type { CatalogStore } from "../ports/catalog-store";

export type SetScheduleEnabledDeps = {
  store: CatalogStore;
  clock: Clock;
  uow: UnitOfWork;
};

export type SetScheduleEnabledInput = {
  id: string;
  enabled: boolean;
};

export type SetScheduleEnabledOutput = {
  schedule: Schedule;
  events: readonly DomainEvent[];
};

export async function setScheduleEnabledCommand(
  deps: SetScheduleEnabledDeps,
  input: SetScheduleEnabledInput,
): Promise<Result<SetScheduleEnabledOutput, UseCaseFailure>> {
  const existing = deps.store.findSchedule(input.id);
  if (!existing) {
    return useCaseFailure("not_found", "Schedule not found", 404);
  }
  const agent = deps.store.agentForSchedule(input.id);

  const nextRunAt = input.enabled
    ? deps.store.computeScheduleNextRun(existing.cronExpr, existing.timezone)
    : undefined;
  const updated = deps.store.updateScheduleEnabled(
    input.id,
    input.enabled,
    nextRunAt,
  );
  if (!updated) {
    return useCaseFailure("not_found", "Schedule not found", 404);
  }
  deps.uow.addEvent(
    domainEvent(
      {
        type: "schedule.updated",
        entityKind: "schedule",
        entityId: updated.id,
        projectId: agent?.projectId ?? null,
        topics: [...SCHEDULE_UPDATED_TOPICS],
        data: { enabled: input.enabled },
      },
      deps.clock.nowIso(),
    ),
  );
  return ok({ schedule: updated, events: deps.uow.events() });
}
