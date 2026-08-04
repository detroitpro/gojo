import { computeScheduleNextRun } from "@/contexts/scheduling/contract";
import {
  syncProjectFromManifest,
  type ProjectSyncResult,
} from "@/contexts/catalog/application/project-sync";
import { ensureProjectRepositorySource } from "@/contexts/work/contract";
import type { Database, Repositories } from "@/infrastructure/persistence";
import {
  getAgentDetail,
  listAgentsPage,
  listImpactItemsPage,
  listProjectsPage,
  listSchedulesPage,
  toProjectDetailRow,
  type AgentDetailRow,
  type AgentListRow,
  type ImpactItemListRow,
  type ListAgentsPageInput,
  type ListImpactItemsPageInput,
  type ListProjectsPageInput,
  type ListSchedulesPageInput,
  type ProjectDetailRow,
  type ProjectListRow,
  type ScheduleListRow,
} from "@/contexts/catalog/infrastructure/catalog-paged-lists";
import type {
  Agent,
  Project,
  Schedule,
} from "@/infrastructure/persistence/types";
import type { PaginatedList } from "@shared/pagination";

import type { CatalogStore } from "../ports/catalog-store";

/**
 * SQLite-backed catalog store; delegates to existing repositories + paged-list
 * queries so no behavior changes during the strangler migration.
 */
export class SqliteCatalogStore implements CatalogStore {
  constructor(
    private readonly db: Database,
    private readonly repos: Repositories,
  ) {}

  listProjects(input: ListProjectsPageInput): PaginatedList<ProjectListRow> {
    return listProjectsPage(this.db, input);
  }

  findProject(id: string): Project | null {
    return this.repos.projects.findById(id);
  }

  toProjectDetail(project: Project): ProjectDetailRow {
    return toProjectDetailRow(this.db, project);
  }

  deleteProject(id: string): boolean {
    return this.repos.projects.delete(id);
  }

  syncProjectFromManifest(project: Project): ProjectSyncResult {
    return syncProjectFromManifest(this.repos, project);
  }

  ensureProjectRepositorySource(projectId: string): void {
    ensureProjectRepositorySource(this.db, projectId);
  }

  listAgents(input: ListAgentsPageInput): PaginatedList<AgentListRow> {
    return listAgentsPage(this.db, input);
  }

  findAgent(id: string): Agent | null {
    return this.repos.agents.findById(id);
  }

  getAgentDetail(id: string): AgentDetailRow | null {
    return getAgentDetail(this.db, id);
  }

  updateAgentEnabled(id: string, enabled: boolean): Agent | null {
    return this.repos.agents.update(id, { enabled });
  }

  listSchedules(
    input: ListSchedulesPageInput,
  ): PaginatedList<ScheduleListRow> {
    return listSchedulesPage(this.db, input);
  }

  findSchedule(id: string): Schedule | null {
    return this.repos.schedules.findById(id);
  }

  agentForSchedule(scheduleId: string): Agent | null {
    const schedule = this.repos.schedules.findById(scheduleId);
    if (!schedule) return null;
    return this.repos.agents.findById(schedule.agentId);
  }

  updateScheduleEnabled(
    id: string,
    enabled: boolean,
    nextRunAt?: string | null,
  ): Schedule | null {
    const patch: Parameters<Repositories["schedules"]["update"]>[1] = { enabled };
    if (nextRunAt !== undefined) {
      patch.nextRunAt = nextRunAt;
    }
    return this.repos.schedules.update(id, patch);
  }

  computeScheduleNextRun(cronExpr: string, timezone: string): string | null {
    return computeScheduleNextRun(cronExpr, timezone);
  }

  listImpactItems(
    input: ListImpactItemsPageInput,
  ): PaginatedList<ImpactItemListRow> {
    return listImpactItemsPage(this.db, input);
  }

}
