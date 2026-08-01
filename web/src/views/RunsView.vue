<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { getQueue, listAgents, listProjects, listRuns, runAgent } from "@/api";
import AppButton from "@/components/AppButton.vue";
import PageHeader from "@/components/PageHeader.vue";
import SortableTh from "@/components/SortableTh.vue";
import StateBadge from "@/components/StateBadge.vue";
import TablePager from "@/components/TablePager.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useServerTable } from "@/composables/useServerTable";
import { MAX_PAGE_LIMIT, type SortOrder } from "@/lib/pagination";
import { Play } from "lucide-vue-next";
import type { Agent, Project } from "@/types";

const RUN_SORT_ALLOWED = [
  "createdAt",
  "finishedAt",
  "state",
  "trigger",
  "agentName",
  "projectName",
] as const;

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

function initialSort(): string {
  const value = queryParam("sort");
  return (RUN_SORT_ALLOWED as readonly string[]).includes(value) ? value : "createdAt";
}

function initialOrder(): SortOrder {
  const value = queryParam("order");
  return value === "asc" || value === "desc" ? value : "desc";
}

const projects = ref<Project[]>([]);
const agents = ref<Agent[]>([]);
const projectFilter = ref(queryParam("projectId"));
const agentFilter = ref(queryParam("agentId"));
const stateFilter = ref(queryParam("state"));
const triggerFilter = ref(queryParam("trigger"));
const fromFilter = ref(queryParam("from"));
const toFilter = ref(queryParam("to"));
const query = ref(queryParam("q"));
const enqueueBusy = ref(false);
const queuePositions = ref<Record<string, number>>({});

const {
  page,
  pages,
  items: runs,
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
  watchSources: [
    projectFilter,
    agentFilter,
    stateFilter,
    triggerFilter,
    fromFilter,
    toFilter,
    query,
  ],
  fetchPage: ({ limit, offset, sort: sortBy, order: sortOrder }) =>
    listRuns({
      limit,
      offset,
      sort: sortBy,
      order: sortOrder,
      projectId: projectFilter.value || undefined,
      agentId: agentFilter.value || undefined,
      state: stateFilter.value || undefined,
      trigger: triggerFilter.value || undefined,
      from: fromFilter.value || undefined,
      to: toFilter.value || undefined,
      q: query.value || undefined,
    }),
});

const selectedAgent = computed(() => {
  if (!agentFilter.value) {
    return null;
  }
  return agents.value.find((agent) => agent.id === agentFilter.value) ?? null;
});

const canEnqueue = computed(() => {
  if (!agentFilter.value) {
    return false;
  }
  if (selectedAgent.value) {
    return selectedAgent.value.enabled;
  }
  // Deep-linked agent id still present even if options failed to resolve.
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

async function loadAgentOptions() {
  const result = await listAgents({
    limit: MAX_PAGE_LIMIT,
    offset: 0,
    projectId: projectFilter.value || undefined,
  });
  agents.value = result.items;
  if (agentFilter.value && !result.items.some((agent) => agent.id === agentFilter.value)) {
    // Keep deep-linked agent visible even if outside current project page.
    const orphan = await listAgents({ limit: 1, offset: 0, q: agentFilter.value });
    const match = orphan.items.find((agent) => agent.id === agentFilter.value);
    if (match) {
      agents.value = [match, ...result.items];
    }
  }
}

async function enqueueSelectedAgent() {
  if (!agentFilter.value || !canEnqueue.value) {
    return;
  }
  enqueueBusy.value = true;
  error.value = "";
  try {
    const run = await runAgent(agentFilter.value);
    await router.push({ name: "run-detail", params: { id: run.id } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to enqueue run";
  } finally {
    enqueueBusy.value = false;
  }
}

watch(
  () =>
    [
      route.query.projectId,
      route.query.agentId,
      route.query.state,
      route.query.trigger,
      route.query.from,
      route.query.to,
      route.query.q,
    ] as const,
  ([projectId, agentId, state, trigger, from, to, q]) => {
    const nextProject = typeof projectId === "string" ? projectId : "";
    const nextAgent = typeof agentId === "string" ? agentId : "";
    const nextState = typeof state === "string" ? state : "";
    const nextTrigger = typeof trigger === "string" ? trigger : "";
    const nextFrom = typeof from === "string" ? from : "";
    const nextTo = typeof to === "string" ? to : "";
    const nextQ = typeof q === "string" ? q : "";
    if (projectFilter.value !== nextProject) projectFilter.value = nextProject;
    if (agentFilter.value !== nextAgent) agentFilter.value = nextAgent;
    if (stateFilter.value !== nextState) stateFilter.value = nextState;
    if (triggerFilter.value !== nextTrigger) triggerFilter.value = nextTrigger;
    if (fromFilter.value !== nextFrom) fromFilter.value = nextFrom;
    if (toFilter.value !== nextTo) toFilter.value = nextTo;
    if (query.value !== nextQ) query.value = nextQ;
  },
);

watch(
  [projectFilter, agentFilter, stateFilter, triggerFilter, fromFilter, toFilter, query, sort, order],
  () => {
    const nextQuery = { ...route.query } as Record<string, string>;
    if (projectFilter.value) nextQuery.projectId = projectFilter.value;
    else delete nextQuery.projectId;
    if (agentFilter.value) nextQuery.agentId = agentFilter.value;
    else delete nextQuery.agentId;
    if (stateFilter.value) nextQuery.state = stateFilter.value;
    else delete nextQuery.state;
    if (triggerFilter.value) nextQuery.trigger = triggerFilter.value;
    else delete nextQuery.trigger;
    if (fromFilter.value) nextQuery.from = fromFilter.value;
    else delete nextQuery.from;
    if (toFilter.value) nextQuery.to = toFilter.value;
    else delete nextQuery.to;
    if (query.value) nextQuery.q = query.value;
    else delete nextQuery.q;
    if (sort.value !== "createdAt" || order.value !== "desc") {
      nextQuery.sort = sort.value;
      nextQuery.order = order.value;
    } else {
      delete nextQuery.sort;
      delete nextQuery.order;
    }
    const same =
      (nextQuery.projectId ?? "") === queryParam("projectId") &&
      (nextQuery.agentId ?? "") === queryParam("agentId") &&
      (nextQuery.state ?? "") === queryParam("state") &&
      (nextQuery.trigger ?? "") === queryParam("trigger") &&
      (nextQuery.from ?? "") === queryParam("from") &&
      (nextQuery.to ?? "") === queryParam("to") &&
      (nextQuery.q ?? "") === queryParam("q") &&
      (nextQuery.sort ?? "") === queryParam("sort") &&
      (nextQuery.order ?? "") === queryParam("order");
    if (!same) {
      void router.replace({ query: nextQuery });
    }
  },
);

watch(projectFilter, () => {
  void loadAgentOptions();
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

useLiveRefresh({
  topics: ["runs", "queue"],
  refresh: async () => {
    await Promise.all([load(), loadQueuePositions()]);
  },
});
useLiveRefresh({
  topics: ["projects", "agents"],
  refresh: async () => {
    await Promise.all([loadProjects(), loadAgentOptions()]);
  },
});
</script>

<template>
  <div>
    <PageHeader title="Runs">
      <template #subtitle>
        <div class="subtitle">
          <template v-if="selectedAgent">
            {{ selectedAgent.name
            }}<span v-if="selectedAgent.projectName"> · {{ selectedAgent.projectName }}</span>
          </template>
          <template v-else>Execution history</template>
        </div>
      </template>
      <template v-if="agentFilter" #actions>
        <AppButton
          variant="primary"
          size="sm"
          :icon="Play"
          :loading="enqueueBusy"
          loading-label="Enqueueing…"
          :disabled="!canEnqueue"
          :title="selectedAgent && !selectedAgent.enabled ? 'Agent is disabled' : undefined"
          @click="enqueueSelectedAgent"
        >
          Enqueue run
        </AppButton>
      </template>
    </PageHeader>

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
        <label for="run-agent-filter">Agent</label>
        <select id="run-agent-filter" v-model="agentFilter">
          <option value="">All agents</option>
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">
            {{ agent.name }}{{ agent.projectName ? ` (${agent.projectName})` : "" }}
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
          placeholder="Agent, project, run id…"
        />
      </div>
      <div class="field task-filter-count">
        <label>&nbsp;</label>
        <span class="muted">{{ total }} run{{ total === 1 ? "" : "s" }}</span>
      </div>
    </div>

    <div v-if="loading && runs.length === 0" class="empty">Loading runs…</div>
    <div v-else-if="total === 0" class="empty">
      {{
        query || projectFilter || agentFilter || stateFilter || triggerFilter
          ? "No runs match these filters"
          : "No runs yet — trigger an agent or wait for the next schedule"
      }}
    </div>
    <template v-else>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <SortableTh
                column="agentName"
                label="Agent"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <SortableTh
                column="projectName"
                label="Project"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <SortableTh
                column="state"
                label="State"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <SortableTh
                column="trigger"
                label="Trigger"
                :sort="sort"
                :order="order"
                @sort="setSort"
              />
              <SortableTh
                column="createdAt"
                label="Created"
                :sort="sort"
                :order="order"
                default-order="desc"
                @sort="setSort"
              />
              <SortableTh
                column="finishedAt"
                label="Finished"
                :sort="sort"
                :order="order"
                default-order="desc"
                @sort="setSort"
              />
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in runs" :key="run.id">
              <td>
                <RouterLink
                  :to="{
                    name: 'agents',
                    query: {
                      projectId: run.projectId,
                      q: run.agentId,
                      enabled: 'all',
                    },
                  }"
                  class="entity-name"
                >
                  {{ run.agentName || "Unknown agent" }}
                </RouterLink>
              </td>
              <td>{{ run.projectName || "Unknown project" }}</td>
              <td>
                <RouterLink :to="{ name: 'run-detail', params: { id: run.id } }">
                  <StateBadge :state="run.state" />
                </RouterLink>
                <div
                  v-if="(run.state === 'Queued' || run.state === 'Scheduled') && queuePositions[run.id]"
                  class="mono muted text-sm"
                >
                  queue #{{ queuePositions[run.id] }}
                </div>
              </td>
              <td class="mono">{{ run.trigger }}</td>
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
