import type { AppContext } from "@/platform/app-context";
import { defaultSourceAdapters } from "@/contexts/work/infrastructure/source-sync";
import type {
  WorkItem,
  WorkRecheckResult,
  WorkResolveInput,
  WorkStatus,
  WorkStatusCompareWindow,
} from "@shared/work";
import type { WorkListInput, WorkPage } from "../ports/work-entities";

import type {
  CreateProjectSourceCommand,
  CreateProjectSourceResult,
  ProjectSourceRow,
  WorkItemDetail,
  WorkStore,
} from "../ports/work-store";

/**
 * Production implementation of {@link WorkStore} backed by the composed
 * `AppContext` services. This is a thin wrapper — no policy lives here.
 * Tests should prefer an in-memory fake at the port boundary.
 */
export class AppWorkStore implements WorkStore {
  constructor(private readonly ctx: AppContext) {}

  projectExists(projectId: string): boolean {
    return this.ctx.repos.projects.findById(projectId) !== null;
  }

  listProjectItems(projectId: string, input: WorkListInput): WorkPage {
    return this.ctx.work.items.listByProject(projectId, input);
  }

  projectStatus(
    projectId: string,
    options: { compareWindow?: WorkStatusCompareWindow },
  ): WorkStatus {
    return this.ctx.work.items.status(projectId, options);
  }

  listProjectSources(projectId: string): ProjectSourceRow[] {
    return this.ctx.work.sources.listByProject(projectId).map((source) => ({
      ...source,
      connection: source.connectionId
        ? this.ctx.work.connections.findById(source.connectionId)
        : null,
      cursor: this.ctx.work.sync.cursor(source.id),
    }));
  }

  createProjectSource(input: CreateProjectSourceCommand): CreateProjectSourceResult {
    const adapter = defaultSourceAdapters().find(
      (candidate) => candidate.type === input.adapter,
    );
    if (!adapter) {
      throw new Error(`Unknown source adapter: ${input.adapter}`);
    }
    const connection = this.ctx.work.connections.create({
      name: input.name,
      adapter: adapter.type,
      baseUrl: input.baseUrl ?? null,
      configJson: JSON.stringify(input.config ?? {}),
      capabilities: adapter.capabilities,
    });
    const source = this.ctx.work.sources.create({
      projectId: input.projectId,
      connectionId: connection.id,
      kind: input.kind,
      externalKey: input.externalKey,
      displayName: input.displayName ?? input.externalKey,
      webUrl: input.webUrl ?? null,
    });
    return { source, connection };
  }

  async refreshSource(sourceId: string, projectId: string): Promise<unknown> {
    const source = this.ctx.work.sources.findById(sourceId);
    if (!source || source.projectId !== projectId) {
      throw new Error(`Project source not found: ${sourceId}`);
    }
    return this.ctx.sourceSync.syncSource(sourceId);
  }

  getWorkItemDetail(workItemId: string): WorkItemDetail | null {
    const work = this.ctx.work.items.findById(workItemId);
    if (!work) return null;
    return {
      work,
      links: this.ctx.work.links.listByWorkItem(workItemId),
      events: this.ctx.work.events.listByWorkItem(workItemId),
      runContext:
        work.kind === "run" && work.nativeKey
          ? this.ctx.work.runContexts.findByRun(work.nativeKey)
          : null,
    };
  }

  async getWorkItemDiff(
    workItemId: string,
  ): Promise<{ workItemId: string; diff: string }> {
    const workItem = this.ctx.work.items.findById(workItemId);
    if (!workItem) throw new Error(`Work item not found: ${workItemId}`);
    const diff = await this.ctx.mergeService.getDiff(workItem.projectId, workItem.id);
    return { workItemId: workItem.id, diff };
  }

  async recheckWorkItem(workItemId: string): Promise<WorkRecheckResult> {
    return this.ctx.sourceSync.recheckWorkItem(workItemId);
  }

  resolveWorkItem(workItemId: string, input: WorkResolveInput): WorkItem {
    return this.ctx.sourceSync.resolveWorkItem(workItemId, input);
  }

  async ingestWebhook(
    sourceId: string,
    body: string,
    signature: string,
  ): Promise<unknown> {
    return this.ctx.sourceWebhooks.ingest(sourceId, body, signature);
  }

  rebuildStatusRollup(input: { projectId?: string; from?: string }): number {
    return this.ctx.work.rollup.rebuild({
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.from ? { from: input.from } : {}),
    });
  }

  findAdapterType(name: string): "known" | "unknown" {
    return defaultSourceAdapters().some((adapter) => adapter.type === name)
      ? "known"
      : "unknown";
  }
}
