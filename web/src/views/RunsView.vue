<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { getQueue, listProjects, listRuns, listTasks, runTask } from "@/api";
import StateBadge from "@/components/StateBadge.vue";
import TablePager from "@/components/TablePager.vue";
import { useServerTable } from "@/composables/useServerTable";
import { MAX_PAGE_LIMIT } from "@/lib/pagination";
import type { Project, Task } from "@/types";

const RUN_STATES = [
  "Scheduled",
  "Queued",
  "Preparing",
  "Running",
  "Validating",
  "AwaitingApproval",
  "Integrating",
  "Reporting",
  "Succeeded",
  "Failed",
  "Canceled",
  "TimedOut",
  "Skipped",
  "Superseded",
  "Abandoned",
  "Blocked",
  "Conflict",
  "InfrastructureFailure",
] as const;

const TRIGGERS = ["schedule", "api", "manual", "heal"] as const;

const route = useRoute();
const router = useRouter();

function queryParam(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

const projects = ref<Project[]>([]);
const tasks = ref<Task[]>([]);
const projectFilter = ref(queryParam("projectId"));
const taskFilter = ref(queryParam("taskId"));
const stateFilter = ref("");
const triggerFilter = ref("");
const query = ref("");
const enqueueBusy = ref(false);
const queuePositions = ref<Record<string, number>>({});

const {
  page,
  pages,
  items: runs,
  total,
  loading,
  error,
  rangeLabel,
  load,
} = useServerTable({
  watchSources: [projectFilter, taskFilter, stateFilter, triggerFilter, query],
  fetchPage: ({ limit, offset }) =>
    listRuns({
      limit,
      offset,
      projectId: projectFilter.value || undefined,
      taskId: taskFilter.value || undefined,
      state: stateFilter.value || undefined,
      trigger: triggerFilter.value || undefined,
      q: query.value || undefined,
    }),
});

const selectedTask = computed(() => {
  if (!taskFilter.value) {
    return null;
  }
  return tasks.value.find((task) => task.id === taskFilter.value) ?? null;
});

const canEnqueue = computed(() => {
  if (!taskFilter.value) {
    return false;
  }
  if (selectedTask.value) {
    return selectedTask.value.enabled;
  }
  // Deep-linked task id still present even if options failed to resolve.
  return true;
});

function fmtTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

async function loadProjects() {
  const result = await listProjects({ limit: MAX_PAGE_LIMIT, offset: 0 });
  projects.value = result.items;
}

async function loadTaskOptions() {
  const result = await listTasks({
    limit: MAX_PAGE_LIMIT,
    offset: 0,
    projectId: projectFilter.value || undefined,
  });
  tasks.value = result.items;
  if (taskFilter.value && !result.items.some((task) => task.id === taskFilter.value)) {
    // Keep deep-linked task visible even if outside current project page.
    const orphan = await listTasks({ limit: 1, offset: 0, q: taskFilter.value });
    const match = orphan.items.find((task) => task.id === taskFilter.value);
    if (match) {
      tasks.value = [match, ...result.items];
    }
  }
}

async function enqueueSelectedTask() {
  if (!taskFilter.value || !canEnqueue.value) {
    return;
  }
  enqueueBusy.value = true;
  error.value = "";
  try {
    const run = await runTask(taskFilter.value);
    await router.push({ name: "run-detail", params: { id: run.id } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to enqueue run";
  } finally {
    enqueueBusy.value = false;
  }
}

watch(
  () => [route.query.projectId, route.query.taskId] as const,
  ([projectId, taskId]) => {
    const nextProject = typeof projectId === "string" ? projectId : "";
    const nextTask = typeof taskId === "string" ? taskId : "";
    if (projectFilter.value !== nextProject) {
      projectFilter.value = nextProject;
    }
    if (taskFilter.value !== nextTask) {
      taskFilter.value = nextTask;
    }
  },
);

watch([projectFilter, taskFilter], () => {
  const nextQuery = { ...route.query } as Record<string, string>;
  if (projectFilter.value) {
    nextQuery.projectId = projectFilter.value;
  } else {
    delete nextQuery.projectId;
  }
  if (taskFilter.value) {
    nextQuery.taskId = taskFilter.value;
  } else {
    delete nextQuery.taskId;
  }
  const same =
    (nextQuery.projectId ?? "") === queryParam("projectId") &&
    (nextQuery.taskId ?? "") === queryParam("taskId");
  if (!same) {
    void router.replace({ query: nextQuery });
  }
});

watch(projectFilter, () => {
  void loadTaskOptions();
});

async function loadQueuePositions() {
  try {
    const snap = await getQueue({ limit: MAX_PAGE_LIMIT, offset: 0 });
    const next: Record<string, number> = {};
    for (const item of snap.waiting) {
      next[item.runId] = item.position;
    }
    queuePositions.value = next;
  } catch {
    queuePositions.value = {};
  }
}

onMounted(() => {
  void loadProjects();
  void loadTaskOptions();
  void load();
  void loadQueuePositions();
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Runs</h1>
        <div class="subtitle">
          <template v-if="selectedTask">
            {{ selectedTask.name
            }}<span v-if="selectedTask.projectName"> · {{ selectedTask.projectName }}</span>
          </template>
          <template v-else>Execution history</template>
        </div>
      </div>
      <div v-if="taskFilter" class="toolbar">
        <button
          class="btn btn-sm btn-primary"
          type="button"
          :disabled="enqueueBusy || !canEnqueue"
          :title="selectedTask && !selectedTask.enabled ? 'Task is disabled' : undefined"
          @click="enqueueSelectedTask"
        >
          {{ enqueueBusy ? "Enqueueing…" : "Enqueue run" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="inline-form mb-7 task-filters">
      <div class="field">
        <label for="run-project-filter">Project</label>
        <select id="run-project-filter" v-model="projectFilter">
          <option value="">All projects</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="run-task-filter">Task</label>
        <select id="run-task-filter" v-model="taskFilter">
          <option value="">All tasks</option>
          <option v-for="task in tasks" :key="task.id" :value="task.id">
            {{ task.name }}{{ task.projectName ? ` (${task.projectName})` : "" }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="run-state-filter">State</label>
        <select id="run-state-filter" v-model="stateFilter">
          <option value="">All states</option>
          <option v-for="state in RUN_STATES" :key="state" :value="state">{{ state }}</option>
        </select>
      </div>
      <div class="field">
        <label for="run-trigger-filter">Trigger</label>
        <select id="run-trigger-filter" v-model="triggerFilter">
          <option value="">All triggers</option>
          <option v-for="trigger in TRIGGERS" :key="trigger" :value="trigger">{{ trigger }}</option>
        </select>
      </div>
      <div class="field flex-2">
        <label for="run-search">Search</label>
        <input
          id="run-search"
          v-model="query"
          class="input"
          type="search"
          placeholder="Task, project, run id…"
        />
      </div>
      <div class="field task-filter-count">
        <label>&nbsp;</label>
        <span class="muted">{{ total }} run{{ total === 1 ? "" : "s" }}</span>
      </div>
    </div>

    <div v-if="loading && runs.length === 0" class="empty">Loading…</div>
    <div v-else-if="total === 0" class="empty">
      {{
        query || projectFilter || taskFilter || stateFilter || triggerFilter
          ? "No runs match these filters"
          : "No runs recorded"
      }}
    </div>
    <template v-else>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Task</th>
              <th>Project</th>
              <th>State</th>
              <th>Trigger</th>
              <th>Run ID</th>
              <th>Created</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in runs" :key="run.id">
              <td>
                <RouterLink
                  :to="{
                    name: 'runs',
                    query: { taskId: run.taskId, projectId: run.projectId },
                  }"
                  class="entity-name"
                >
                  {{ run.taskName || "Unknown task" }}
                </RouterLink>
                <div class="mono muted text-sm">{{ run.taskId.slice(0, 10) }}…</div>
              </td>
              <td>
                <div>{{ run.projectName || "Unknown project" }}</div>
                <div class="mono muted text-sm">{{ run.projectId.slice(0, 10) }}…</div>
              </td>
              <td>
                <StateBadge :state="run.state" />
                <div
                  v-if="(run.state === 'Queued' || run.state === 'Scheduled') && queuePositions[run.id]"
                  class="mono muted text-sm"
                >
                  queue #{{ queuePositions[run.id] }}
                </div>
              </td>
              <td class="mono">{{ run.trigger }}</td>
              <td>
                <RouterLink :to="{ name: 'run-detail', params: { id: run.id } }" class="mono">
                  {{ run.id.slice(0, 12) }}…
                </RouterLink>
              </td>
              <td class="mono muted">{{ fmtTime(run.createdAt) }}</td>
              <td class="mono muted">{{ fmtTime(run.finishedAt) }}</td>
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
