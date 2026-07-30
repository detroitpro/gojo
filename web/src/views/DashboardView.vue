<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import {
  getDashboard,
  getDashboardImpact,
  getDashboardOverview,
  pauseInstance,
  resumeInstance,
} from "@/api";
import AppButton from "@/components/AppButton.vue";
import StatGrid from "@/components/StatGrid.vue";
import StatTile from "@/components/StatTile.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import RunHistoryStrip from "@/components/RunHistoryStrip.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useSoftLoading } from "@/composables/useSoftLoading";
import { formatRunSuccessRate } from "@/lib/run-success-rate";
import { compareLabel } from "@/lib/stat-metrics";
import { pausedStatus } from "@/lib/status-icons";
import { Pause, Play } from "lucide-vue-next";
import type {
  DashboardImpact,
  DashboardOverviewProject,
  DashboardPreviousStats,
} from "@/types";

const route = useRoute();
const router = useRouter();

function queryParam(key: string): string {
  const value = route.query[key];
  return typeof value === "string" ? value : "";
}

const { loading, begin: beginLoad, end: endLoad } = useSoftLoading();
const error = ref("");
const paused = ref(false);
const runningRuns = ref(0);
const waitingRuns = ref(0);
const projectCount = ref(0);
const agentCount = ref(0);
const scheduleCount = ref(0);
const runsTotal = ref(0);
const dashboardPrevious = ref<DashboardPreviousStats | null>(null);
const projects = ref<DashboardOverviewProject[]>([]);
const pauseBusy = ref(false);
const projectFilter = ref(queryParam("projectId"));

type ImpactRange = "30d" | "90d" | "all";

function initialImpactRange(): ImpactRange {
  const value = queryParam("range");
  return value === "90d" || value === "all" ? value : "30d";
}

const impact = ref<DashboardImpact | null>(null);
const impactRange = ref<ImpactRange>(initialImpactRange());

const visibleProjects = computed(() => {
  if (!projectFilter.value) {
    return projects.value;
  }
  return projects.value.filter((project) => project.id === projectFilter.value);
});

function impactCompareLabel(): string {
  return compareLabel("previousWindow", impact.value?.range);
}

function withProjectQuery(base: Record<string, string> = {}): Record<string, string> {
  if (projectFilter.value) {
    return { ...base, projectId: projectFilter.value };
  }
  return base;
}

function impactWindowQuery(base: Record<string, string> = {}): Record<string, string> {
  const query = withProjectQuery(base);
  const from = impact.value?.window.from;
  const to = impact.value?.window.to;
  if (from) query.from = from;
  if (to) query.to = to;
  if (impactRange.value !== "all") {
    query.range = impactRange.value;
  }
  return query;
}

const projectsRoute = computed(() => ({ name: "projects" as const }));
const agentsRoute = computed(() => ({
  name: "agents" as const,
  query: withProjectQuery(),
}));
const schedulesRoute = computed(() => ({
  name: "schedules" as const,
  query: withProjectQuery(),
}));
const runsRoute = computed(() => ({
  name: "runs" as const,
  query: withProjectQuery(),
}));
const succeededRunsRoute = computed(() => ({
  name: "runs" as const,
  query: impactWindowQuery({ state: "Succeeded" }),
}));
const mergedRoute = computed(() => ({
  name: "integrations" as const,
  query: impactWindowQuery({ status: "merged" }),
}));
const commitsRoute = computed(() => ({
  name: "integrations" as const,
  query: impactWindowQuery({ status: "committed" }),
}));

const prsOpenRoute = computed(() => {
  const total = impact.value?.totals.prsOpen ?? 0;
  if (total <= 0) {
    return undefined;
  }
  if (projectFilter.value) {
    return {
      name: "project-detail",
      params: { id: projectFilter.value },
      hash: "#open-prs",
    };
  }
  return { name: "projects", query: { hasOpenPrs: "1" } };
});

function categoryRoute(category: string) {
  return {
    name: "impact" as const,
    query: impactWindowQuery({ category }),
  };
}

const runsCompareLabel = computed(() =>
  compareLabel("asOf", dashboardPrevious.value?.compareWindow),
);

async function loadImpact() {
  try {
    impact.value = await getDashboardImpact({
      ...(projectFilter.value ? { projectId: projectFilter.value } : {}),
      range: impactRange.value,
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
  const initial = beginLoad();
  error.value = "";
  try {
    const [dashboard, overview] = await Promise.all([
      getDashboard(),
      getDashboardOverview(),
    ]);
    paused.value = dashboard.paused;
    runningRuns.value = dashboard.runningRuns ?? 0;
    waitingRuns.value = dashboard.waitingRuns ?? 0;
    projectCount.value = dashboard.projects;
    agentCount.value = dashboard.agents;
    scheduleCount.value = dashboard.schedules;
    runsTotal.value = dashboard.runs;
    dashboardPrevious.value = dashboard.previous ?? null;
    projects.value = overview.projects;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load dashboard";
  } finally {
    endLoad(initial);
  }
}

async function togglePause() {
  pauseBusy.value = true;
  try {
    if (paused.value) {
      await resumeInstance();
    } else {
      await pauseInstance();
    }
    await load();
  } finally {
    pauseBusy.value = false;
  }
}

watch(
  () => [route.query.projectId, route.query.range] as const,
  ([projectId, range]) => {
    const nextProject = typeof projectId === "string" ? projectId : "";
    const nextRange: ImpactRange =
      range === "90d" || range === "all" ? range : "30d";
    if (nextProject !== projectFilter.value) {
      projectFilter.value = nextProject;
    }
    if (nextRange !== impactRange.value) {
      impactRange.value = nextRange;
    }
  },
);

watch([projectFilter, impactRange], ([project, range]) => {
  const nextQuery = { ...route.query } as Record<string, string>;
  if (project) {
    nextQuery.projectId = project;
  } else {
    delete nextQuery.projectId;
  }
  if (range !== "30d") {
    nextQuery.range = range;
  } else {
    delete nextQuery.range;
  }
  const same =
    (nextQuery.projectId ?? "") === queryParam("projectId") &&
    (nextQuery.range ?? "") === queryParam("range");
  if (!same) {
    void router.replace({ query: nextQuery });
  }
});

useLiveRefresh({
  topics: ["dashboard", "overview"],
  refresh: load,
});
useLiveRefresh({
  topics: ["impact"],
  refresh: loadImpact,
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1>Dashboard</h1>
        <div class="subtitle">Live scheduler pulse — what is running, waiting, and shipping</div>
      </div>
      <div class="toolbar">
        <StatusBadge
          v-if="paused"
          :icon="pausedStatus().icon"
          :tone="pausedStatus().tone"
          :label="pausedStatus().label"
        />
        <AppButton
          size="sm"
          :icon="paused ? Play : Pause"
          :loading="pauseBusy"
          loading-label="Working…"
          @click="togglePause"
        >
          {{ paused ? "Resume scheduler" : "Pause scheduler" }}
        </AppButton>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="loading" class="empty">Loading ops overview…</div>

    <template v-else>
      <div class="status-band" :class="{ 'is-paused': paused }">
        <div class="status-band-primary">
          <div class="label">{{ paused ? "Scheduler" : "Active now" }}</div>
          <div class="value" :class="{ 'is-paused': paused }">
            {{ paused ? "Paused" : runningRuns }}
          </div>
          <div class="hint">
            <template v-if="paused">Cron stays quiet until you resume</template>
            <template v-else>
              {{ waitingRuns }} waiting in queue ·
              <RouterLink :to="{ name: 'queue' }">open queue</RouterLink>
            </template>
          </div>
        </div>
        <StatGrid class="status-band-secondary">
          <StatTile
            metric-key="dashboard.projects"
            :value="projectCount"
            :to="projectsRoute"
          />
          <StatTile metric-key="dashboard.agents" :value="agentCount" :to="agentsRoute" />
          <StatTile
            metric-key="dashboard.schedules"
            :value="scheduleCount"
            :to="schedulesRoute"
          />
          <StatTile
            metric-key="dashboard.runs"
            :value="runsTotal"
            :previous="dashboardPrevious?.runs"
            :compare-label="runsCompareLabel"
            :to="runsRoute"
          />
        </StatGrid>
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
          <StatGrid>
            <StatTile
              metric-key="impact.mergedRuns"
              :value="impact.totals.mergedRuns"
              :previous="impact.previousTotals?.mergedRuns"
              :compare-label="impactCompareLabel()"
              :to="mergedRoute"
            />
            <StatTile
              metric-key="impact.prsOpen"
              :value="impact.totals.prsOpen"
              :previous="impact.previousTotals?.prsOpen"
              :compare-label="impactCompareLabel()"
              :to="prsOpenRoute"
            />
            <StatTile
              metric-key="impact.mergeRate"
              :value="impact.totals.mergeRate"
              :previous="impact.previousTotals?.mergeRate"
              :compare-label="impactCompareLabel()"
              :to="mergedRoute"
            />
            <StatTile
              metric-key="impact.commits"
              :value="impact.totals.commits"
              :previous="impact.previousTotals?.commits"
              :compare-label="impactCompareLabel()"
              :to="commitsRoute"
            />
            <StatTile
              metric-key="impact.succeededRuns"
              :value="impact.totals.succeededRuns"
              :previous="impact.previousTotals?.succeededRuns"
              :compare-label="impactCompareLabel()"
              :to="succeededRunsRoute"
            />
          </StatGrid>

          <StatGrid v-if="impact.categoryTotals.length > 0" class="impact-category-stats">
            <StatTile
              v-for="entry in impact.categoryTotals"
              :key="entry.category"
              :metric-key="`impact.category.${entry.category}`"
              :value="entry.runs"
              :to="categoryRoute(entry.category)"
            />
          </StatGrid>
          <div v-else class="muted text-sm impact-empty">
            No impact items recorded in this range
          </div>
        </div>
      </section>

      <div v-if="projects.length === 0" class="empty">
        No projects yet — add one from Projects, then Sync its gojo.yaml
      </div>

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

        <section v-for="project in visibleProjects" :key="project.id" class="list-section">
          <div class="list-section__header">
            <h2 class="list-section__title list-section__title--plain">
              <RouterLink
                :to="{ name: 'project-detail', params: { id: project.id } }"
                class="entity-name"
              >
                {{ project.name }}
              </RouterLink>
            </h2>
            <span class="list-section__meta">
              {{ project.agents.length }} agent{{ project.agents.length === 1 ? "" : "s" }}
            </span>
          </div>
          <div v-if="project.agents.length === 0" class="muted">No enabled agents</div>
          <div v-else class="table-wrap">
            <table class="data dashboard-task-table">
              <colgroup>
                <col class="dashboard-col-task" />
                <col class="dashboard-col-runs" />
                <col class="dashboard-col-rate" />
              </colgroup>
              <thead>
                <tr>
                  <th class="dashboard-col-task">Agent</th>
                  <th class="dashboard-col-runs">Recent runs</th>
                  <th class="dashboard-col-rate">Success</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="agent in project.agents" :key="agent.id">
                  <td class="dashboard-col-task">
                    <RouterLink
                      :to="{ name: 'agent-detail', params: { id: agent.id } }"
                      class="entity-name"
                    >
                      {{ agent.name }}
                    </RouterLink>
                    <div v-if="agent.description" class="muted text-sm">{{ agent.description }}</div>
                  </td>
                  <td class="dashboard-col-runs">
                    <RunHistoryStrip :runs="agent.recentRuns" />
                  </td>
                  <td class="dashboard-col-rate mono">
                    {{ formatRunSuccessRate(agent.recentRuns) }}
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
  width: 12rem;
  min-width: 12rem;
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
