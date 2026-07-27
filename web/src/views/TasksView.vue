<script setup lang="ts">
import { ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { disableTask, enableTask, listProjects, listTasks, runTask } from "@/api";
import ActionMenu, { type ActionMenuItem } from "@/components/ActionMenu.vue";
import RunHistoryStrip from "@/components/RunHistoryStrip.vue";
import SortableTh from "@/components/SortableTh.vue";
import TablePager from "@/components/TablePager.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useServerTable } from "@/composables/useServerTable";
import { MAX_PAGE_LIMIT, type SortOrder } from "@/lib/pagination";
import { formatRunSuccessRate } from "@/lib/run-success-rate";
import type { Project, Task } from "@/types";

const TASK_SORT_ALLOWED = [
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
  return (TASK_SORT_ALLOWED as readonly string[]).includes(value) ? value : "name";
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
  items: tasks,
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
    listTasks({
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

function rowActions(task: Task): ActionMenuItem[] {
  return [
    {
      id: "open",
      label: "Open",
      to: { name: "task-detail", params: { id: task.id } },
    },
    {
      id: "run",
      label: "Run now",
      disabled: busyId.value === task.id || !task.enabled,
    },
    {
      id: "view-runs",
      label: "View runs",
      to: {
        name: "runs",
        query: {
          taskId: task.id,
          ...(task.projectId ? { projectId: task.projectId } : {}),
        },
      },
    },
    {
      id: "view-schedules",
      label: "View schedules",
      to: {
        name: "schedules",
        query: {
          taskId: task.id,
          ...(task.projectId ? { projectId: task.projectId } : {}),
          enabled: "all",
        },
      },
    },
    {
      id: "toggle-enabled",
      label: task.enabled ? "Disable" : "Enable",
      disabled: busyId.value === task.id,
    },
  ];
}

async function runNow(task: Task) {
  busyId.value = task.id;
  error.value = "";
  try {
    const run = await runTask(task.id);
    await router.push(`/runs/${run.id}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to start run";
  } finally {
    busyId.value = null;
  }
}

async function toggleEnabled(task: Task) {
  busyId.value = task.id;
  error.value = "";
  try {
    if (task.enabled) {
      await disableTask(task.id);
    } else {
      await enableTask(task.id);
    }
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to update task";
  } finally {
    busyId.value = null;
  }
}

function onAction(task: Task, actionId: string) {
  if (actionId === "run") {
    void runNow(task);
  } else if (actionId === "toggle-enabled") {
    void toggleEnabled(task);
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
  topics: ["tasks", "runs", "overview"],
  refresh: load,
});
useLiveRefresh({
  topics: ["projects"],
  refresh: loadProjects,
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Tasks</h1>
        <div class="subtitle">Manifest-synced and API-created tasks across all projects</div>
      </div>
    </header>

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
        <label for="task-search">Search</label>
        <input
          id="task-search"
          v-model="query"
          class="input"
          type="search"
          placeholder="Name, description, project…"
        />
      </div>
      <div class="field task-filter-count">
        <label>&nbsp;</label>
        <span class="muted">{{ total }} task{{ total === 1 ? "" : "s" }}</span>
      </div>
    </div>

    <div v-if="loading && tasks.length === 0" class="empty">Loading tasks…</div>
    <div v-else-if="projects.length === 0" class="empty">
      Add a project first, then Sync its gojo.yaml
    </div>
    <div v-else-if="total === 0" class="empty">
      {{
        query || projectFilter || enabledFilter !== "all"
          ? "No tasks match these filters"
          : "No tasks yet — Sync a project manifest to pull tasks from gojo.yaml"
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
              <th>Agent</th>
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
            <tr v-for="task in tasks" :key="task.id">
              <td>
                <RouterLink
                  :to="{ name: 'task-detail', params: { id: task.id } }"
                  class="entity-name"
                >
                  {{ task.name }}
                </RouterLink>
                <div v-if="task.description" class="muted text-sm">
                  {{ task.description }}
                </div>
              </td>
              <td>{{ task.projectName || "—" }}</td>
              <td class="tasks-col-runs">
                <RunHistoryStrip :runs="task.recentRuns ?? []" />
              </td>
              <td class="tasks-col-rate mono">
                {{ formatRunSuccessRate(task.recentRuns ?? []) }}
              </td>
              <td>
                <span v-if="task.enabled" class="badge badge-success">enabled</span>
                <span v-else class="badge badge-neutral">disabled</span>
              </td>
              <td>{{ task.agentProfileName || "—" }}</td>
              <td class="mono muted">{{ new Date(task.createdAt).toLocaleString() }}</td>
              <td class="actions-cell">
                <ActionMenu
                  :items="rowActions(task)"
                  :disabled="busyId === task.id"
                  :label="`Actions for ${task.name}`"
                  @select="(id) => onAction(task, id)"
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
