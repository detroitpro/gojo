/**
 * Public surface of the catalog context.
 * Other contexts may import only from this module.
 */
export type { AdapterRegistryPort } from "./ports/adapter-registry";
export type { CatalogStore } from "./ports/catalog-store";
export type { FilesystemBrowserPort } from "./ports/filesystem-browser";

export {
  AGENT_UPDATED_TOPICS,
  PROJECT_DELETED_TOPICS,
  PROJECT_SYNCED_TOPICS,
  PROJECT_UPDATED_TOPICS,
  SCHEDULE_UPDATED_TOPICS,
} from "./domain/events";

export type {
  SyncProjectDeps,
  SyncProjectInput,
  SyncProjectOutput,
} from "./application/sync-project";
export { syncProjectCommand } from "./application/sync-project";

export type { ListProjectsInput } from "./application/list-projects";
export { listProjectsQuery } from "./application/list-projects";
export type { GetProjectInput } from "./application/get-project";
export { getProjectQuery } from "./application/get-project";
export type {
  DeleteProjectDeps,
  DeleteProjectInput,
  DeleteProjectOutput,
} from "./application/delete-project";
export { deleteProjectCommand } from "./application/delete-project";

export type { ListAgentsInput } from "./application/list-agents";
export { listAgentsQuery } from "./application/list-agents";
export type { GetAgentInput } from "./application/get-agent";
export { getAgentQuery } from "./application/get-agent";
export type {
  SetAgentEnabledDeps,
  SetAgentEnabledInput,
  SetAgentEnabledOutput,
} from "./application/set-agent-enabled";
export { setAgentEnabledCommand } from "./application/set-agent-enabled";

export type {
  SetProjectEnabledDeps,
  SetProjectEnabledInput,
  SetProjectEnabledOutput,
} from "./application/set-project-enabled";
export { setProjectEnabledCommand } from "./application/set-project-enabled";

export type { ListSchedulesInput } from "./application/list-schedules";
export { listSchedulesQuery } from "./application/list-schedules";
export type {
  SetScheduleEnabledDeps,
  SetScheduleEnabledInput,
  SetScheduleEnabledOutput,
} from "./application/set-schedule-enabled";
export { setScheduleEnabledCommand } from "./application/set-schedule-enabled";

export type { ListAdaptersOutput } from "./application/list-adapters";
export { listAdaptersQuery } from "./application/list-adapters";
export type { TestAdapterInput } from "./application/test-adapter";
export { testAdapterCommand } from "./application/test-adapter";

export type { BrowseFilesystemInput } from "./application/browse-filesystem";
export { browseFilesystemQuery } from "./application/browse-filesystem";

export type { ListImpactItemsInput } from "./application/list-impact-items";
export { listImpactItemsQuery } from "./application/list-impact-items";

export type { ImpactItemListRow } from "./infrastructure/catalog-paged-lists";

export {
  syncProjectFromManifest,
  type ProjectSyncResult,
} from "./application/project-sync";

export {
  createCatalogRepositories,
} from "./infrastructure/catalog-repositories";
export {
  getAgentDetail,
  listAgentsPage,
  listImpactItemsPage,
  listProjectsPage,
  listSchedulesPage,
  projectSummaryFor,
  toProjectDetailRow,
} from "./infrastructure/catalog-paged-lists";
export type {
  AgentDetailRow,
  AgentListRow,
  ListAgentsPageInput,
  ListImpactItemsPageInput,
  ListProjectsPageInput,
  ListSchedulesPageInput,
  ProjectDetailRow,
  ProjectListRow,
  ScheduleListRow,
} from "./infrastructure/catalog-paged-lists";
