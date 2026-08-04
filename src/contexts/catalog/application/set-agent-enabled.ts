import {
  domainEvent,
  ok,
  type Clock,
  type DomainEvent,
  type Result,
  type UnitOfWork,
} from "@/kernel";
import { useCaseFailure, type UseCaseFailure } from "@/platform/errors";
import type { Agent } from "@/infrastructure/persistence/types";

import { AGENT_UPDATED_TOPICS } from "../domain/events";
import type { CatalogStore } from "../ports/catalog-store";

export type SetAgentEnabledDeps = {
  store: CatalogStore;
  clock: Clock;
  uow: UnitOfWork;
};

export type SetAgentEnabledInput = {
  id: string;
  enabled: boolean;
};

export type SetAgentEnabledOutput = {
  agent: Agent;
  events: readonly DomainEvent[];
};

export async function setAgentEnabledCommand(
  deps: SetAgentEnabledDeps,
  input: SetAgentEnabledInput,
): Promise<Result<SetAgentEnabledOutput, UseCaseFailure>> {
  const existing = deps.store.findAgent(input.id);
  if (!existing) {
    return useCaseFailure("not_found", "Agent not found", 404);
  }
  const updated = deps.store.updateAgentEnabled(input.id, input.enabled);
  if (!updated) {
    return useCaseFailure("not_found", "Agent not found", 404);
  }
  deps.uow.addEvent(
    domainEvent(
      {
        type: "agent.updated",
        entityKind: "agent",
        entityId: updated.id,
        projectId: updated.projectId,
        topics: [...AGENT_UPDATED_TOPICS],
        data: { enabled: input.enabled },
      },
      deps.clock.nowIso(),
    ),
  );
  return ok({ agent: updated, events: deps.uow.events() });
}
