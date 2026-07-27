<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import {
  getDashboard,
  getDashboardImpact,
  getDashboardOverview,
  pauseInstance,
  resumeInstance,
} from "@/api";
import RunHistoryStrip from "@/components/RunHistoryStrip.vue";
import { formatMergeRate, impactCountLabel } from "@/lib/impact-format";
import { formatRunSuccessRate } from "@/lib/run-success-rate";
import type { DashboardImpact, DashboardOverviewProject } from "@/types";

const route = useRoute();
const router = useRouter();

function queryParam(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

const loading = ref(true);
const error = ref("");
const paused = ref(false);
const activeRuns = ref(0);
const projectCount = ref(0);
const taskCount = ref(0);
const scheduleCount = ref(0);
const runsTotal = ref(0);
const projects = ref<DashboardOverviewProject[]>([]);
const projectFilter = ref(queryParam("projectId"));

type ImpactRange = "30d" | "90d" | "all";
const impact = ref<DashboardImpact | null>(null);
const impactRange = ref<ImpactRange>("30d");

const visibleProjects = computed(() => {
  if (!projectFilter.value) {
    return projects.value;
  }
  return projects.value.filter((project) => project.id === projectFilter.value);
});

function impactFrom(range: ImpactRange): string | undefined {
  if (range === "all") {
    return undefined;
  }
  const days = range === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function loadImpact() {
  try {
    const from = impactFrom(impactRange.value);
    impact.value = await getDashboardImpact({
      ...(projectFilter.value ? { projectId: projectFilter.value } : {}),
      ...(from ? { from } : {}),
    });
  } catch {
    // Impact accounting is additive; keep the dashboard usable without it.
    impact.value = null;
  }
}

watch([projectFilter, impactRange], () => {
  void loadImpact();
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [dashboard, overview] = await Promise.all([
      getDashboard(),
      getDashboardOverview(),
    ]);
    paused.value = dashboard.paused;
    activeRuns.value = dashboard.activeRuns;
    projectCount.value = dashboard.projects;
    taskCount.value = dashboard.tasks;
    scheduleCount.value = dashboard.schedules;
    runsTotal.value = dashboard.runs;
    projects.value = overview.projects;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load dashboard";
  } finally {
    loading.value = false;
  }
}

async function togglePause() {
  if (paused.value) {
    await resumeInstance();
  } else {
    await pauseInstance();
  }
  await load();
}

watch(
  () => route.query.projectId,
  (projectId) => {
    const next = typeof projectId === "string" ? projectId : "";
    if (next !== projectFilter.value) {
      projectFilter.value = next;
    }
  },
);

watch(projectFilter, (value) => {
  const current = queryParam("projectId");
  if (value === current) {
    return;
  }
  const nextQuery = { ...route.query };
  if (value) {
    nextQuery.projectId = value;
  } else {
    delete nextQuery.projectId;
  }
  void router.replace({ query: nextQuery });
});

onMounted(() => {
  void load();
  void loadImpact();
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Dashboard</h1>
        <div class="subtitle">Scheduler ops overview</div>
      </div>
      <div class="toolbar">
        <span v-if="paused" class="badge badge-warn">Paused</span>
        <button class="btn btn-sm" type="button" @click="togglePause">
          {{ paused ? "Resume scheduler" : "Pause scheduler" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="loading" class="empty">Loading…</div>

    <template v-else>
      <div class="stats-row">
        <div class="stat">
          <div class="label">Projects</div>
          <div class="value">{{ projectCount }}</div>
        </div>
        <div class="stat">
          <div class="label">Tasks</div>
          <div class="value">{{ taskCount }}</div>
        </div>
        <div class="stat">
          <div class="label">Schedules</div>
          <div class="value">{{ scheduleCount }}</div>
        </div>
        <div class="stat">
          <div class="label">Runs</div>
          <div class="value">{{ runsTotal }}</div>
        </div>
        <div class="stat">
          <div class="label">Active</div>
          <div class="value ok">{{ activeRuns }}</div>
        </div>
      </div>

      <section v-if="impact" class="panel">
        <div class="panel-header impact-header">
          <span>Impact</span>
          <select
            id="dashboard-impact-range"
            v-model="impactRange"
            class="select"
            aria-label="Impact time range"
          >
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">Lifetime</option>
          </select>
        </div>
        <div class="panel-body">
          <div class="stats-row impact-stats">
            <div class="stat">
              <div class="label">Merged</div>
              <div class="value ok">{{ impact.totals.mergedRuns }}</div>
            </div>
            <div class="stat">
              <div class="label">PRs open</div>
              <div class="value">{{ impact.totals.prsOpen }}</div>
            </div>
            <div class="stat">
              <div class="label">Merge rate</div>
              <div class="value">{{ formatMergeRate(impact.totals.mergeRate) }}</div>
            </div>
            <div class="stat">
              <div class="label">Commits</div>
              <div class="value">{{ impact.totals.commits }}</div>
            </div>
            <div class="stat">
              <div class="label">Succeeded runs</div>
              <div class="value">{{ impact.totals.succeededRuns }}</div>
            </div>
          </div>

          <div v-if="impact.categories.length > 0" class="stats-row impact-stats impact-category-stats">
            <div
              v-for="entry in impact.categories"
              :key="`${entry.category}-${entry.verification}`"
              class="stat"
              :title="`${entry.verification} (trust level)`"
            >
              <div class="label">
                {{ impactCountLabel(entry.category, entry.verification) }}
              </div>
              <div class="value">{{ entry.count }}</div>
            </div>
          </div>
          <div v-else class="muted text-sm impact-empty">
            No impact items recorded in this range
          </div>
        </div>
      </section>

      <div v-if="projects.length === 0" class="empty">No projects registered</div>

      <template v-else>
        <div class="filter-bar mb-7">
          <select
            id="dashboard-project-filter"
            v-model="projectFilter"
            class="select"
            aria-label="Project"
          >
            <option value="">All projects</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select>
        </div>

        <div v-if="visibleProjects.length === 0" class="empty">No project matches this filter</div>

        <section v-for="project in visibleProjects" :key="project.id" class="panel">
          <div class="panel-header">
            <RouterLink
              :to="{ name: 'project-detail', params: { id: project.id } }"
              class="entity-name"
            >
              {{ project.name }}
            </RouterLink>
          </div>
          <div v-if="project.tasks.length === 0" class="panel-body muted">No enabled tasks</div>
          <div v-else class="table-wrap">
            <table class="data dashboard-task-table">
              <colgroup>
                <col class="dashboard-col-task" />
                <col class="dashboard-col-runs" />
                <col class="dashboard-col-rate" />
              </colgroup>
              <thead>
                <tr>
                  <th class="dashboard-col-task">Task</th>
                  <th class="dashboard-col-runs">Recent runs</th>
                  <th class="dashboard-col-rate">Success</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="task in project.tasks" :key="task.id">
                  <td class="dashboard-col-task">
                    <RouterLink
                      :to="{
                        name: 'runs',
                        query: { taskId: task.id, projectId: project.id },
                      }"
                      class="entity-name"
                    >
                      {{ task.name }}
                    </RouterLink>
                    <div v-if="task.description" class="muted text-sm">{{ task.description }}</div>
                  </td>
                  <td class="dashboard-col-runs">
                    <RunHistoryStrip :runs="task.recentRuns" />
                  </td>
                  <td class="dashboard-col-rate mono">
                    {{ formatRunSuccessRate(task.recentRuns) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.dashboard-task-table {
  table-layout: fixed;
  width: 100%;
}

/* Beat global table.data th/td text-align:left */
.dashboard-task-table :deep(th.dashboard-col-task),
.dashboard-task-table :deep(td.dashboard-col-task) {
  text-align: left;
}

.dashboard-task-table :deep(.dashboard-col-runs) {
  width: 9.5rem;
  text-align: right;
}

.dashboard-task-table :deep(.dashboard-col-rate) {
  width: 5.5rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.impact-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.impact-stats {
  margin-bottom: 0;
}

.impact-category-stats {
  margin-top: 1rem;
}

.impact-empty {
  margin-top: 1rem;
}
</style>
