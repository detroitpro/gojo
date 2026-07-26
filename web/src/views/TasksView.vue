<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { listProjects, listTasks, runTask } from "@/api";
import StateBadge from "@/components/StateBadge.vue";
import TablePager from "@/components/TablePager.vue";
import { useServerTable } from "@/composables/useServerTable";
import { MAX_PAGE_LIMIT } from "@/lib/pagination";
import type { Project } from "@/types";

const route = useRoute();
const router = useRouter();

function queryParam(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

const projects = ref<Project[]>([]);
const projectFilter = ref(queryParam("projectId"));
const enabledFilter = ref<"all" | "enabled" | "disabled">("all");
const query = ref("");
const busyId = ref<string | null>(null);

const {
  page,
  pages,
  items: tasks,
  total,
  loading,
  error,
  rangeLabel,
  load,
} = useServerTable({
  watchSources: [projectFilter, enabledFilter, query],
  fetchPage: ({ limit, offset }) =>
    listTasks({
      limit,
      offset,
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

function fmtTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

watch(
  () => route.query.projectId,
  (value) => {
    const next = typeof value === "string" ? value : "";
    if (projectFilter.value !== next) {
      projectFilter.value = next;
    }
  },
);

watch(projectFilter, (value) => {
  const current = queryParam("projectId");
  if (value === current) {
    return;
  }
  const nextQuery = { ...route.query } as Record<string, string>;
  if (value) {
    nextQuery.projectId = value;
  } else {
    delete nextQuery.projectId;
  }
  void router.replace({ query: nextQuery });
});

onMounted(() => {
  void loadProjects();
  void load();
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
          <option value="all">All</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
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
        <table class="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Project</th>
              <th>Last run</th>
              <th>Enabled</th>
              <th>Agent</th>
              <th>Created</th>
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
              <td>
                <template v-if="task.lastRunId && task.lastRunState">
                  <RouterLink :to="`/runs/${task.lastRunId}`" class="last-run-link">
                    <StateBadge :state="task.lastRunState" />
                  </RouterLink>
                  <div class="mono muted text-sm">{{ fmtTime(task.lastRunCreatedAt) }}</div>
                </template>
                <span v-else class="muted">—</span>
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
