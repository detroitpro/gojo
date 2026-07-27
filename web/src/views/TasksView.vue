<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { listProjects, listTasks, runTask } from "@/api";
import RunHistoryStrip from "@/components/RunHistoryStrip.vue";
import SortableTh from "@/components/SortableTh.vue";
import TablePager from "@/components/TablePager.vue";
import { useServerTable } from "@/composables/useServerTable";
import { MAX_PAGE_LIMIT, type SortOrder } from "@/lib/pagination";
import { formatRunSuccessRate } from "@/lib/run-success-rate";
import type { Project } from "@/types";

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

async function runNow(id: string) {
  busyId.value = id;
  error.value = "";
  try {
    const run = await runTask(id);
    await router.push(`/runs/${run.id}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to start run";
  } finally {
    busyId.value = null;
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

/** Keep recent-run strip live while this page is open. */
let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  void loadProjects();
  void load();
  refreshTimer = setInterval(() => {
    void load();
  }, 4_000);
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
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

    <div v-if="loading && tasks.length === 0" class="empty">Loading…</div>
    <div v-else-if="projects.length === 0" class="empty">Add a project first</div>
    <div v-else-if="total === 0" class="empty">
      {{
        query || projectFilter || enabledFilter !== "all"
          ? "No tasks match these filters"
          : "No tasks yet — sync a project manifest"
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
                  :to="{
                    name: 'runs',
                    query: {
                      taskId: task.id,
                      ...(task.projectId ? { projectId: task.projectId } : {}),
                    },
                  }"
                  class="entity-name"
                >
                  {{ task.name }}
                </RouterLink>
                <div class="mono muted text-sm">{{ task.id.slice(0, 10) }}…</div>
                <div v-if="task.description" class="muted text-sm">
                  {{ task.description }}
                </div>
              </td>
              <td>
                <div>{{ task.projectName || "—" }}</div>
                <div class="mono muted text-sm">{{ task.projectId.slice(0, 10) }}…</div>
              </td>
              <td class="tasks-col-runs">
                <RunHistoryStrip :runs="task.recentRuns ?? []" />
              </td>
              <td class="tasks-col-rate mono">
                {{ formatRunSuccessRate(task.recentRuns ?? []) }}
              </td>
              <td>{{ task.enabled ? "yes" : "no" }}</td>
              <td>
                <div>{{ task.agentProfileName || "—" }}</div>
                <div v-if="task.agentProfileId" class="mono muted text-sm">
                  {{ task.agentProfileId.slice(0, 10) }}…
                </div>
              </td>
              <td class="mono muted">{{ new Date(task.createdAt).toLocaleString() }}</td>
              <td>
                <button
                  class="btn btn-sm btn-primary"
                  type="button"
                  :disabled="busyId === task.id || !task.enabled"
                  @click="runNow(task.id)"
                >
                  Run now
                </button>
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
