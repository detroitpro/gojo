import type { AppContext } from "@/platform/app-context";
import type {
  WorkAttention,
  WorkDelivery,
  WorkExecution,
  WorkItem,
  WorkOutcome,
  WorkProvenance,
  WorkRecheckResult,
  WorkStatus,
  WorkStatusCompareWindow,
} from "@shared/work";
import type { WorkPage } from "@/contexts/work/infrastructure/work-repositories";
import {
  InMemoryUnitOfWork,
  SystemClock,
  type Clock,
  type Outbox,
  type UnitOfWork,
} from "@/kernel";

import { failureMessage } from "@/platform/errors";

import { createProjectSourceCommand } from "./application/create-project-source";
import { getProjectWorkStatusQuery } from "./application/get-project-work-status";
import { getWorkItemQuery } from "./application/get-work-item";
import { getWorkItemDiffQuery } from "./application/get-work-item-diff";
import { ingestSourceWebhookCommand } from "./application/ingest-source-webhook";
import { listProjectSourcesQuery } from "./application/list-project-sources";
import { listProjectWorkQuery } from "./application/list-project-work";
import { rebuildWorkStatusCommand } from "./application/rebuild-work-status";
import { recheckWorkItemCommand } from "./application/recheck-work-item";
import { refreshProjectSourceCommand } from "./application/refresh-project-source";
import { resolveWorkItemCommand } from "./application/resolve-work-item";
import { AppWorkStore } from "./infrastructure/app-work-store";
import type {
  CreateProjectSourceCommand,
  CreateProjectSourceResult,
  ProjectSourceRow,
  WorkItemDetail,
  WorkStore,
} from "./ports/work-store";

export * from "./contract";

export type WorkModule = {
  listProjectWork(
    projectId: string,
    input: {
      limit: number;
      offset: number;
      kind?: string | null;
      provenance?: WorkProvenance | null;
      delivery?: WorkDelivery | null;
      attention?: WorkAttention | null;
      execution?: WorkExecution | null;
      outcome?: WorkOutcome | null;
      sourceId?: string | null;
      actor?: string | null;
      label?: string | null;
      from?: string | null;
      to?: string | null;
      q?: string | null;
      history?: boolean;
    },
  ): Promise<WorkPage>;
  getProjectStatus(
    projectId: string,
    options?: { compareWindow?: WorkStatusCompareWindow },
  ): Promise<WorkStatus>;
  listProjectSources(projectId: string): Promise<ProjectSourceRow[]>;
  createProjectSource(
    input: CreateProjectSourceCommand,
  ): Promise<CreateProjectSourceResult>;
  refreshProjectSource(input: {
    projectId: string;
    sourceId: string;
  }): Promise<{ sync: unknown }>;
  getWorkItem(id: string): Promise<WorkItemDetail | null>;
  getWorkItemDiff(id: string): Promise<{ workItemId: string; diff: string }>;
  recheckWorkItem(id: string): Promise<{ result: WorkRecheckResult }>;
  resolveWorkItem(
    id: string,
    input: { resolvedBy?: string | null; note?: string | null },
  ): Promise<{ work: WorkItem }>;
  ingestSourceWebhook(input: {
    sourceId: string;
    body: string;
    signature: string;
  }): Promise<unknown>;
  rebuildWorkStatus(input: {
    projectId?: string | null;
    from?: string | null;
  }): Promise<{ rebuilt: true; deleted: number }>;
};

export function buildWorkModule(deps: {
  ctx: AppContext;
  store?: WorkStore;
  clock?: Clock;
  outbox?: Outbox;
  uow?: UnitOfWork;
}): WorkModule {
  const store = deps.store ?? new AppWorkStore(deps.ctx);
  const clock = deps.clock ?? new SystemClock();
  const uow = deps.uow ?? new InMemoryUnitOfWork();

  return {
    async listProjectWork(projectId, input) {
      const result = await listProjectWorkQuery({ store }, { projectId, ...input });
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
    async getProjectStatus(projectId, options = {}) {
      const result = await getProjectWorkStatusQuery(
        { store },
        {
          projectId,
          ...(options.compareWindow ? { compareWindow: options.compareWindow } : {}),
        },
      );
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
    async listProjectSources(projectId) {
      const result = await listProjectSourcesQuery({ store }, { projectId });
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value.sources;
    },
    async createProjectSource(input) {
      uow.clearEvents();
      const result = await createProjectSourceCommand({ store, clock, uow }, input);
      if (!result.ok) throw new Error(failureMessage(result.error));
      if (deps.outbox) {
        deps.outbox.publish(result.value.events);
        uow.clearEvents();
      }
      return { source: result.value.source, connection: result.value.connection };
    },
    async refreshProjectSource(input) {
      const result = await refreshProjectSourceCommand({ store }, input);
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
    async getWorkItem(id) {
      const result = await getWorkItemQuery({ store }, { id });
      if (result.ok) return result.value;
      return null;
    },
    async getWorkItemDiff(id) {
      const result = await getWorkItemDiffQuery({ store }, { id });
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
    async recheckWorkItem(id) {
      const result = await recheckWorkItemCommand({ store }, { id });
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
    async resolveWorkItem(id, input) {
      const result = await resolveWorkItemCommand({ store }, {
        id,
        resolvedBy: input.resolvedBy ?? null,
        note: input.note ?? null,
      });
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
    async ingestSourceWebhook(input) {
      const result = await ingestSourceWebhookCommand({ store }, input);
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
    async rebuildWorkStatus(input) {
      const result = await rebuildWorkStatusCommand({ store }, input);
      if (!result.ok) throw new Error(failureMessage(result.error));
      return result.value;
    },
  };
}
