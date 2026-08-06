<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { ArrowRight } from "lucide-vue-next";

import { getDashboardImpact } from "@/contexts/operations/contract";
import { bindStoreRefresh } from "@/platform/bind-store-refresh";
import { useOperationsStore } from "@/contexts/operations/contract";
import AppButton from "@/ui/AppButton.vue";
import StatGrid from "@/ui/StatGrid.vue";
import StatTile from "@/ui/StatTile.vue";
import VerificationBadge from "@/ui/status/VerificationBadge.vue";
import { compareLabel } from "@/kernel/stat-metrics";
import type { DashboardImpact } from "@/contexts/operations/contract";

const props = withDefaults(
  defineProps<{
    projectId: string;
    openPrTotal: number;
    /** compact = stats + See more; full = categories, agents, recent items */
    mode?: "compact" | "full";
  }>(),
  { mode: "full" },
);

type ImpactRange = "30d" | "90d" | "all";

const impact = ref<DashboardImpact | null>(null);
const impactRange = ref<ImpactRange>("30d");
const hiddenAgentIds = ref<Set<string>>(new Set());

const operationsStore = useOperationsStore();

function impactCompareLabel(): string {
  return compareLabel("previousWindow", impact.value?.range);
}

function impactWindowQuery(base: Record<string, string> = {}): Record<string, string> {
  const query: Record<string, string> = {
    ...base,
    projectId: props.projectId,
  };
  const from = impact.value?.window.from;
  const to = impact.value?.window.to;
  if (from) query.from = from;
  if (to) query.to = to;
  if (impactRange.value !== "all") {
    query.range = impactRange.value;
  }
  return query;
}

const mergedRoute = computed(() => ({
  name: "integrations" as const,
  query: impactWindowQuery({ status: "merged" }),
}));
const commitsRoute = computed(() => ({
  name: "integrations" as const,
  query: impactWindowQuery({ status: "committed" }),
}));
const succeededRunsRoute = computed(() => ({
  name: "runs" as const,
  query: impactWindowQuery({ state: "Succeeded" }),
}));
const deliveryRoute = computed(() => ({
  name: "project-overview" as const,
  params: { id: props.projectId },
  hash: "#attention",
}));
const projectImpactRoute = computed(() => ({
  name: "project-impact" as const,
  params: { id: props.projectId },
}));
const browseAllRoute = computed(() => ({
  name: "impact" as const,
  query: impactWindowQuery(),
}));

function categoryRoute(category: string) {
  return {
    name: "impact" as const,
    query: impactWindowQuery({ category }),
  };
}

const impactAgents = computed(() => {
  const items = impact.value?.recentItems ?? [];
  const byId = new Map<string, string>();
  for (const item of items) {
    if (!byId.has(item.agentId)) {
      byId.set(item.agentId, item.agentName);
    }
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

const visibleImpactItems = computed(() => {
  const items = impact.value?.recentItems ?? [];
  if (hiddenAgentIds.value.size === 0) {
    return items;
  }
  return items.filter((item) => !hiddenAgentIds.value.has(item.agentId));
});

function isAgentVisible(agentId: string): boolean {
  return !hiddenAgentIds.value.has(agentId);
}

function toggleAgentVisibility(agentId: string) {
  const next = new Set(hiddenAgentIds.value);
  if (next.has(agentId)) {
    next.delete(agentId);
  } else {
    next.add(agentId);
  }
  hiddenAgentIds.value = next;
}

async function loadImpact() {
  try {
    impact.value = await getDashboardImpact({
      projectId: props.projectId,
      range: impactRange.value,
    });
    const known = new Set(impactAgents.value.map((agent) => agent.id));
    const next = new Set([...hiddenAgentIds.value].filter((id) => known.has(id)));
    if (next.size !== hiddenAgentIds.value.size) {
      hiddenAgentIds.value = next;
    }
  } catch {
    impact.value = null;
  }
}

watch(() => props.projectId, () => {
  impact.value = null;
  hiddenAgentIds.value = new Set();
  void loadImpact();
});

watch(impactRange, () => {
  void loadImpact();
});

bindStoreRefresh(operationsStore, loadImpact);
</script>

<template>
  <section v-if="impact" class="panel mb-7">
    <div class="panel-header impact-header">
      <span>Impact</span>
      <div class="impact-header-actions">
        <select
          :id="`project-impact-range-${mode}`"
          v-model="impactRange"
          class="select"
          aria-label="Impact time range"
        >
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">Lifetime</option>
        </select>
        <AppButton
          v-if="mode === 'compact'"
          size="sm"
          :icon="ArrowRight"
          :to="projectImpactRoute"
        >
          See more
        </AppButton>
      </div>
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
          :value="openPrTotal"
          :previous="impact.previousTotals?.prsOpen"
          :compare-label="impactCompareLabel()"
          :to="openPrTotal > 0 ? deliveryRoute : undefined"
        />
        <StatTile
          metric-key="impact.mergeRate"
          :value="impact.totals.mergeRate"
          :previous="impact.previousTotals?.mergeRate"
          :compare-label="impactCompareLabel()"
        />
        <StatTile
          metric-key="impact.succeededRuns"
          :value="impact.totals.succeededRuns"
          :previous="impact.previousTotals?.succeededRuns"
          :compare-label="impactCompareLabel()"
          :to="succeededRunsRoute"
        />
        <StatTile
          metric-key="impact.commits"
          :value="impact.totals.commits"
          :previous="impact.previousTotals?.commits"
          :compare-label="impactCompareLabel()"
          :to="commitsRoute"
        />
      </StatGrid>

      <template v-if="mode === 'full'">
        <div v-if="impact.categoryTotals.length" class="mt-5">
          <div class="panel-subheader">By category</div>
          <div class="category-chips">
            <RouterLink
              v-for="row in impact.categoryTotals"
              :key="row.category"
              :to="categoryRoute(row.category)"
              class="category-chip"
            >
              {{ row.category }}
              <span class="category-chip__count">{{ row.runs }}</span>
            </RouterLink>
          </div>
        </div>
        <div v-if="impactAgents.length" class="mt-5">
          <div class="panel-subheader">Agents in range</div>
          <div class="agent-visibility">
            <button
              v-for="agent in impactAgents"
              :key="agent.id"
              type="button"
              class="agent-visibility__chip"
              :class="{ 'agent-visibility__chip--hidden': !isAgentVisible(agent.id) }"
              @click="toggleAgentVisibility(agent.id)"
            >
              {{ agent.name }}
            </button>
          </div>
        </div>
        <div v-if="visibleImpactItems.length" class="table-wrap mt-5">
          <table class="data">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Subject</th>
                <th>Summary</th>
                <th>Trust</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in visibleImpactItems" :key="item.id">
                <td>
                  <RouterLink
                    :to="{ name: 'run-detail', params: { id: item.runId } }"
                    class="entity-name"
                  >
                    {{ item.agentName }}
                  </RouterLink>
                </td>
                <td class="mono">{{ item.subject }}</td>
                <td>{{ item.summary }}</td>
                <td>
                  <VerificationBadge :verification="item.verification" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-else-if="impact.recentItems.length > 0"
          class="muted text-sm impact-empty"
        >
          All agents are hidden — turn an agent back on to see its impact items
        </div>
        <div class="toolbar mt-5">
          <AppButton size="sm" :icon="ArrowRight" :to="browseAllRoute">
            Browse all impact items
          </AppButton>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.impact-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.impact-header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
</style>
