<script setup lang="ts">
import { ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { disableAgent, enableAgent, listAgents, listProjects, runAgent } from "@/api";
import ActionMenu, { type ActionMenuItem } from "@/components/ActionMenu.vue";
import PageHeader from "@/components/PageHeader.vue";
import EnabledBadge from "@/components/status/EnabledBadge.vue";
import RunHistoryStrip from "@/components/RunHistoryStrip.vue";
import SortableTh from "@/components/SortableTh.vue";
import TablePager from "@/components/TablePager.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useServerTable } from "@/composables/useServerTable";
import { MAX_PAGE_LIMIT, type SortOrder } from "@/lib/pagination";
import { formatRunSuccessRate } from "@/lib/run-success-rate";
import type { Agent, Project } from "@/types";

const AGENT_SORT_ALLOWED = [
  "name",
  "projectName",
  "enabled",
  "createdAt",
  "lastRunAt",
  "successRate",
] as const;

const route = useRoute();
const router = useRouter();

function queryParam(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

function initialSort(): string {
  const value = queryParam("sort");
  return (AGENT_SORT_ALLOWED as readonly string[]).includes(value) ? value : "name";
}

function initialOrder(): SortOrder {
  const value = queryParam("order");
  return value === "asc" || value === "desc" ? value : "asc";
}

function initialEnabled(): "all" | "enabled" | "disabled" {
  const value = queryParam("enabled");
  return value === "all" || value === "disabled" ? value : "enabled";
}

const projects = ref<Project[]>([]);
const projectFilter = ref(queryParam("projectId"));
const enabledFilter = ref<"all" | "enabled" | "disabled">(initialEnabled());
const query = ref(queryParam("q"));
const busyId = ref<string | null>(null);

const {
  page,
  pages,
  items: agents,
  total,
  loading,
  error,
  sort,
  order,
  setSort,
  rangeLabel,
  load,
} = useServerTable({
  defaultSort: initialSort(),
  defaultOrder: initialOrder(),
  watchSources: [projectFilter, enabledFilter, query],
  fetchPage: ({ limit, offset, sort: sortBy, order: sortOrder }) =>
    listAgents({
      limit,
      offset,
      sort: sortBy,
      order: sortOrder,
      projectId: projectFilter.value || undefined,
      enabled: enabledFilter.value,
      q: query.value || undefined,
    }),
});

async function loadProjects() {
  const result = await listProjects({ limit: MAX_PAGE_LIMIT, offset: 0 });
  projects.value = result.items;
}

function rowActions(agent: Agent): ActionMenuItem[] {
  return [
    {
      id: "open",
      label: "Open",
      to: { name: "agent-detail", params: { id: agent.id } },
    },
    {
      id: "run",
      label: "Run now",
      disabled: busyId.value === agent.id || !agent.enabled,
    },
    {
      id: "view-runs",
      label: "View runs",
      to: {
        name: "runs",
        query: {
          agentId: agent.id,
          ...(agent.projectId ? { projectId: agent.projectId } : {}),
        },
      },
    },
    {
      id: "view-schedules",
      label: "View schedules",
      to: {
        name: "schedules",
        query: {
          agentId: agent.id,
          ...(agent.projectId ? { projectId: agent.projectId } : {}),
          enabled: "all",
        },
      },
    },
    {
      id: "toggle-enabled",
      label: agent.enabled ? "Disable" : "Enable",
      disabled: busyId.value === agent.id,
    },
  ];
}

async function runNow(agent: Agent) {
  busyId.value = agent.id;
  error.value = "";
  try {
    const run = await runAgent(agent.id);
    await router.push(`/runs/${run.id}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to start run";
  } finally {
    busyId.value = null;
  }
}

async function toggleEnabled(agent: Agent) {
  busyId.value = agent.id;
  error.value = "";
  try {
    if (agent.enabled) {
      await disableAgent(agent.id);
    } else {
      await enableAgent(agent.id);
    }
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to update agent";
  } finally {
    busyId.value = null;
  }
}

function onAction(agent: Agent, actionId: string) {
  if (actionId === "run") {
    void runNow(agent);
  } else if (actionId === "toggle-enabled") {
    void toggleEnabled(agent);
  }
}

watch(
  () => [route.query.projectId, route.query.q, route.query.enabled] as const,
  ([projectId, q, enabled]) => {
    const nextProject = typeof projectId === "string" ? projectId : "";
    const nextQ = typeof q === "string" ? q : "";
    const nextEnabled =
      enabled === "all" || enabled === "disabled" || enabled === "enabled"
        ? enabled
        : "enabled";
    if (projectFilter.value !== nextProject) {
      projectFilter.value = nextProject;
    }
    if (query.value !== nextQ) {
      query.value = nextQ;
    }
    if (enabledFilter.value !== nextEnabled) {
      enabledFilter.value = nextEnabled;
    }
  },
);

watch([projectFilter, enabledFilter, query, sort, order], () => {
  const nextQuery = { ...route.query } as Record<string, string>;
  if (projectFilter.value) {
    nextQuery.projectId = projectFilter.value;
  } else {
    delete nextQuery.projectId;
  }
  if (query.value) {
    nextQuery.q = query.value;
  } else {
    delete nextQuery.q;
  }
  if (enabledFilter.value !== "enabled") {
    nextQuery.enabled = enabledFilter.value;
  } else {
    delete nextQuery.enabled;
  }
  if (sort.value !== "name" || order.value !== "asc") {
    nextQuery.sort = sort.value;
    nextQuery.order = order.value;
  } else {
    delete nextQuery.sort;
    delete nextQuery.order;
  }
  const same =
    (nextQuery.projectId ?? "") === queryParam("projectId") &&
    (nextQuery.q ?? "") === queryParam("q") &&
    (nextQuery.enabled ?? "") === queryParam("enabled") &&
    (nextQuery.sort ?? "") === queryParam("sort") &&
    (nextQuery.order ?? "") === queryParam("order");
  if (!same) {
    void router.replace({ query: nextQuery });
  }
});

useLiveRefresh({
  topics: ["agents", "runs", "overview"],
  refresh: load,
});
useLiveRefresh({
  topics: ["projects"],
  refresh: loadProjects,
});
</script>

<template>
  <div>
    <PageHeader
      title="Agents"
      subtitle="Manifest-synced and API-created agents across all projects"
    />

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="inline-form mb-7 task-filters">
      <div class="field">
        <label for="project-filter">Project</label>
        <select id="project-filter" v-model="projectFilter">
          <option value="">All projects</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="enabled-filter">Enabled</label>
        <select id="enabled-filter" v-model="enabledFilter">
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
          <option value="all">All</option>
        </select>
      </div>
      <div class="field flex-2">
        <label for="agent-search">Search</label>
        <input
          id="agent-search"
          v-model="query"
          class="input"
          type="search"
          placeholder="Name, description, project…"
        />
      </div>
      <div class="field task-filter-count">
        <label>&nbsp;</label>
        <span class="muted">{{ total }} agent{{ total === 1 ? "" : "s" }}</span>
      </div>
    </div>

    <div v-if="loading && agents.length === 0" class="empty">Loading agents…</div>
    <div v-else-if="projects.length === 0" class="empty">
      Add a project first, then Sync its gojo.yaml
    </div>
    <div v-else-if="total === 0" class="empty">
      {{
        query || projectFilter || enabledFilter !== "all"
          ? "No agents match these filters"
          : "No agents yet — Sync a project manifest to pull agents from gojo.yaml"
      }}
    </div>
    <template v-else>
      <div class="table-wrap">
        <table class="data tasks-table">
          <thead>
            <tr>
              <SortableTh column="name" label="Name" :sort="sort" :order="order" @sort="setSort" />
              <SortableTh
                column="projectName"
                label="Project"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <th class="tasks-col-runs">Recent runs</th>
              <SortableTh
                column="successRate"
                label="Success"
                :sort="sort"
                :order="order"
                default-order="asc"
                @sort="setSort"
              />
              <SortableTh
                column="enabled"
                label="Enabled"
                :sort="sort"
                :order="order"
                default-order="desc"
                @sort="setSort"
              />
              <th>Profile</th>
              <SortableTh
                column="createdAt"
                label="Created"
                :sort="sort"
                :order="order"
                default-order="desc"
                @sort="setSort"
              />
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="agent in agents" :key="agent.id">
              <td>
                <RouterLink
                  :to="{ name: 'agent-detail', params: { id: agent.id } }"
                  class="entity-name"
                >
                  {{ agent.name }}
                </RouterLink>
                <div v-if="agent.description" class="muted text-sm">
                  {{ agent.description }}
                </div>
              </td>
              <td>{{ agent.projectName || "—" }}</td>
              <td class="tasks-col-runs">
                <RunHistoryStrip :runs="agent.recentRuns ?? []" />
              </td>
              <td class="tasks-col-rate mono">
                {{ formatRunSuccessRate(agent.recentRuns ?? []) }}
              </td>
              <td>
                <EnabledBadge :enabled="agent.enabled" />
              </td>
              <td>{{ agent.profileName || "—" }}</td>
              <td class="mono muted">{{ new Date(agent.createdAt).toLocaleString() }}</td>
              <td class="actions-cell">
                <ActionMenu
                  :items="rowActions(agent)"
                  :disabled="busyId === agent.id"
                  :label="`Actions for ${agent.name}`"
                  @select="(id) => onAction(agent, id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <TablePager
        v-model:page="page"
        :page-count="pages"
        :range-label="rangeLabel"
        :total="total"
      />
    </template>
  </div>
</template>

<style scoped>
.tasks-table :deep(th.tasks-col-runs),
.tasks-table :deep(td.tasks-col-runs) {
  width: 12rem;
  min-width: 12rem;
  text-align: right;
  vertical-align: middle;
}

.tasks-table :deep(th.tasks-col-rate),
.tasks-table :deep(td.tasks-col-rate) {
  width: 5.5rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
