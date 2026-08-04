import type {
  Agent,
  Project,
  Schedule,
} from "@/infrastructure/persistence/types";
import type {
  AgentDetailRow,
  AgentListRow,
  ImpactItemListRow,
  ListAgentsPageInput,
  ListImpactItemsPageInput,
  ListProjectsPageInput,
  ListSchedulesPageInput,
  ProjectDetailRow,
  ProjectListRow,
  ScheduleListRow,
} from "../infrastructure/catalog-paged-lists";

export type {
  AgentDetailRow,
  AgentListRow,
  ImpactItemListRow,
  ListAgentsPageInput,
  ListImpactItemsPageInput,
  ListProjectsPageInput,
  ListSchedulesPageInput,
  ProjectDetailRow,
  ProjectListRow,
  ScheduleListRow,
};
import type { PaginatedList } from "@shared/pagination";

import type { ProjectSyncResult } from "../application/project-sync";

/**
 * Port over the SQLite catalog store.
 * Represents the read/write surface the catalog use cases need.
 * The concrete adapter lives under `infrastructure/`.
 */
export interface CatalogStore {
  listProjects(input: ListProjectsPageInput): PaginatedList<ProjectListRow>;
  findProject(id: string): Project | null;
  toProjectDetail(project: Project): ProjectDetailRow;
  deleteProject(id: string): boolean;

  syncProjectFromManifest(project: Project): ProjectSyncResult;
  ensureProjectRepositorySource(projectId: string): void;

  listAgents(input: ListAgentsPageInput): PaginatedList<AgentListRow>;
  findAgent(id: string): Agent | null;
  getAgentDetail(id: string): AgentDetailRow | null;
  updateAgentEnabled(id: string, enabled: boolean): Agent | null;

  listSchedules(input: ListSchedulesPageInput): PaginatedList<ScheduleListRow>;
  findSchedule(id: string): Schedule | null;
  agentForSchedule(scheduleId: string): Agent | null;
  updateScheduleEnabled(
    id: string,
    enabled: boolean,
    nextRunAt?: string | null,
  ): Schedule | null;
  computeScheduleNextRun(cronExpr: string, timezone: string): string | null;

  listImpactItems(
    input: ListImpactItemsPageInput,
  ): PaginatedList<ImpactItemListRow>;
}
