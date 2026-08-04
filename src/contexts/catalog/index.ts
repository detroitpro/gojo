import type { AppContext } from "@/platform/app-context";
import {
  InMemoryUnitOfWork,
  SystemClock,
  type Clock,
  type Outbox,
} from "@/kernel";

import {
  browseFilesystemQuery,
  type BrowseFilesystemInput,
} from "./application/browse-filesystem";
import {
  deleteProjectCommand,
  type DeleteProjectInput,
} from "./application/delete-project";
import {
  getAgentQuery,
  type GetAgentInput,
} from "./application/get-agent";
import {
  getProjectQuery,
  type GetProjectInput,
} from "./application/get-project";
import {
  listAdaptersQuery,
} from "./application/list-adapters";
import {
  listAgentsQuery,
  type ListAgentsInput,
} from "./application/list-agents";
import {
  listImpactItemsQuery,
  type ListImpactItemsInput,
} from "./application/list-impact-items";
import {
  listProjectsQuery,
  type ListProjectsInput,
} from "./application/list-projects";
import {
  listSchedulesQuery,
  type ListSchedulesInput,
} from "./application/list-schedules";
import {
  setAgentEnabledCommand,
  type SetAgentEnabledInput,
} from "./application/set-agent-enabled";
import {
  setProjectEnabledCommand,
  type SetProjectEnabledInput,
} from "./application/set-project-enabled";
import {
  setScheduleEnabledCommand,
  type SetScheduleEnabledInput,
} from "./application/set-schedule-enabled";
import {
  syncProjectCommand,
  type SyncProjectInput,
} from "./application/sync-project";
import {
  testAdapterCommand,
  type TestAdapterInput,
} from "./application/test-adapter";
import { InProcessAdapterRegistry } from "./infrastructure/in-process-adapter-registry";
import { NodeFilesystemBrowser } from "./infrastructure/node-filesystem-browser";
import { SqliteCatalogStore } from "./infrastructure/sqlite-catalog-store";
import type { AdapterRegistryPort } from "./ports/adapter-registry";
import type { CatalogStore } from "./ports/catalog-store";
import type { FilesystemBrowserPort } from "./ports/filesystem-browser";

export * from "./contract";

export type BuildCatalogModuleDeps = {
  ctx: AppContext;
  clock?: Clock;
  outbox?: Outbox;
  store?: CatalogStore;
  adapters?: AdapterRegistryPort;
  filesystem?: FilesystemBrowserPort;
};

export function buildCatalogModule(deps: BuildCatalogModuleDeps) {
  const clock = deps.clock ?? new SystemClock();
  const store = deps.store ?? new SqliteCatalogStore(deps.ctx.db, deps.ctx.repos);
  const adapters = deps.adapters ?? new InProcessAdapterRegistry();
  const filesystem = deps.filesystem ?? new NodeFilesystemBrowser();

  return {
    store,
    adapters,
    filesystem,

    listProjects: (input: ListProjectsInput) => listProjectsQuery(store, input),
    getProject: (input: GetProjectInput) => getProjectQuery(store, input),
    deleteProject: async (input: DeleteProjectInput) => {
      const uow = new InMemoryUnitOfWork();
      const result = await deleteProjectCommand({ store, clock, uow }, input);
      if (result.ok && deps.outbox) {
        deps.outbox.publish(result.value.events);
        uow.clearEvents();
      }
      return result;
    },

    syncProject: async (input: SyncProjectInput) => {
      const uow = new InMemoryUnitOfWork();
      const result = await syncProjectCommand({ store, clock, uow }, input);
      if (result.ok && deps.outbox) {
        deps.outbox.publish(result.value.events);
        uow.clearEvents();
      }
      return result;
    },

    setProjectEnabled: async (input: SetProjectEnabledInput) => {
      const uow = new InMemoryUnitOfWork();
      const result = await setProjectEnabledCommand({ store, clock, uow }, input);
      if (result.ok && deps.outbox) {
        deps.outbox.publish(result.value.events);
        uow.clearEvents();
      }
      return result;
    },

    listAgents: (input: ListAgentsInput) => listAgentsQuery(store, input),
    getAgent: (input: GetAgentInput) => getAgentQuery(store, input),
    setAgentEnabled: async (input: SetAgentEnabledInput) => {
      const uow = new InMemoryUnitOfWork();
      const result = await setAgentEnabledCommand({ store, clock, uow }, input);
      if (result.ok && deps.outbox) {
        deps.outbox.publish(result.value.events);
        uow.clearEvents();
      }
      return result;
    },

    listSchedules: (input: ListSchedulesInput) => listSchedulesQuery(store, input),
    setScheduleEnabled: async (input: SetScheduleEnabledInput) => {
      const uow = new InMemoryUnitOfWork();
      const result = await setScheduleEnabledCommand(
        { store, clock, uow },
        input,
      );
      if (result.ok && deps.outbox) {
        deps.outbox.publish(result.value.events);
        uow.clearEvents();
      }
      return result;
    },

    listAdapters: () => listAdaptersQuery(adapters),
    testAdapter: (input: TestAdapterInput) => testAdapterCommand(adapters, input),

    browseFilesystem: (input: BrowseFilesystemInput) =>
      browseFilesystemQuery(filesystem, input),

    listImpactItems: (input: ListImpactItemsInput) =>
      listImpactItemsQuery(store, input),
  };
}
