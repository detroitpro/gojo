<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ArrowRight } from "lucide-vue-next";

import { getDashboardImpact, useOperationsStore } from "@/contexts/operations/contract";
import type { DashboardImpact } from "@/contexts/operations/contract";
import { listIntegrations } from "@/contexts/delivery/contract";
import { listProjectWork } from "@/contexts/work/contract";
import { bindStoreRefresh } from "@/platform/bind-store-refresh";
import type { AvailableWorkInventory } from "@/kernel/project-overview";
import { forgeWorkListUrl } from "@/kernel/project-overview";
import { compareLabel } from "@/kernel/stat-metrics";
import AppButton from "@/ui/AppButton.vue";
import StatTile from "@/ui/StatTile.vue";

const props = withDefaults(
  defineProps<{
    projectId: string;
    /** @deprecated Do not use for PR counts — verifiedOpen includes issues. */
    openPrTotal?: number;
    availableWork?: AvailableWorkInventory;
    /** Repository browse URL (source webUrl or remote without .git). */
    repositoryWebUrl?: string | null;
  }>(),
  {
    openPrTotal: 0,
    availableWork: () => ({ openIssues: 0, openPullRequests: 0 }),
    repositoryWebUrl: null,
  },
);

type ImpactRange = "30d" | "90d" | "all";

const impact = ref<DashboardImpact | null>(null);
const impactRange = ref<ImpactRange>("30d");
const closedIssuesInPeriod = ref<number | null>(null);
const mergedPrsInPeriod = ref<number | null>(null);
const closedPrsInPeriod = ref<number | null>(null);
const openIssuesTotal = ref<number | null>(null);
const openPullRequestsTotal = ref<number | null>(null);
const openIntegrationPrs = ref<number | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

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
const openPrsIntegrationsRoute = computed(() => ({
  name: "integrations" as const,
  query: { projectId: props.projectId, status: "open" },
}));
const projectImpactRoute = computed(() => ({
  name: "project-impact" as const,
  params: { id: props.projectId },
}));

const rangeLabel = computed(() => {
  if (impactRange.value === "90d") return "Last 90 days";
  if (impactRange.value === "all") return "Lifetime";
  return "Last 30 days";
});

const displayOpenIssues = computed(
  () => openIssuesTotal.value ?? props.availableWork.openIssues,
);
const displayOpenPullRequests = computed(
  () => openPullRequestsTotal.value ?? props.availableWork.openPullRequests,
);
const displayOpenPrs = computed(() => {
  if ((openIntegrationPrs.value ?? 0) > 0) return openIntegrationPrs.value ?? 0;
  return displayOpenPullRequests.value;
});

const openIssuesHref = computed(() =>
  forgeWorkListUrl(props.repositoryWebUrl, "issue", "open"),
);
const closedIssuesHref = computed(() =>
  forgeWorkListUrl(props.repositoryWebUrl, "issue", "closed"),
);
const openPullsHref = computed(() =>
  forgeWorkListUrl(props.repositoryWebUrl, "pull-request", "open"),
);
const mergedPullsHref = computed(() =>
  forgeWorkListUrl(props.repositoryWebUrl, "pull-request", "merged"),
);
const closedPullsHref = computed(() =>
  forgeWorkListUrl(props.repositoryWebUrl, "pull-request", "closed"),
);

/** Prefer in-app Integrations when gojo has open run PRs; otherwise forge. */
const openPrsLink = computed(() => {
  if ((openIntegrationPrs.value ?? 0) > 0) {
    return { to: openPrsIntegrationsRoute.value, href: undefined as string | undefined };
  }
  if (openPullsHref.value) {
    return { to: undefined, href: openPullsHref.value };
  }
  return { to: undefined, href: undefined };
});

/** Prefer in-app Integrations for merged run PRs in window; otherwise forge. */
const mergedPrsLink = computed(() => {
  if ((mergedPrsInPeriod.value ?? 0) > 0) {
    return { to: mergedRoute.value, href: undefined as string | undefined };
  }
  if (mergedPullsHref.value) {
    return { to: undefined, href: mergedPullsHref.value };
  }
  return { to: undefined, href: undefined };
});

const showBacklog = computed(
  () =>
    Boolean(props.repositoryWebUrl) ||
    displayOpenIssues.value > 0 ||
    (closedIssuesInPeriod.value ?? 0) > 0 ||
    (mergedPrsInPeriod.value ?? 0) > 0 ||
    (closedPrsInPeriod.value ?? 0) > 0 ||
    openIssuesTotal.value != null,
);

const hasAnySignal = computed(() => {
  if (showBacklog.value) return true;
  if (!impact.value) return false;
  const t = impact.value.totals;
  return (
    t.succeededRuns > 0 ||
    t.mergedRuns > 0 ||
    t.commits > 0 ||
    t.prsOpened > 0 ||
    impact.value.categoryTotals.length > 0
  );
});

async function loadBacklogCounts() {
  const from = impact.value?.window.from ?? undefined;
  const to = impact.value?.window.to ?? undefined;
  const [
    closedIssues,
    openIssues,
    openPrs,
    mergedPrs,
    closedPrs,
    openIntegrations,
  ] = await Promise.all([
    listProjectWork(props.projectId, {
      limit: 1,
      offset: 0,
      history: true,
      kind: "issue",
      delivery: "closed",
      from,
      to,
    }).catch(() => null),
    listProjectWork(props.projectId, {
      limit: 1,
      offset: 0,
      kind: "issue",
      delivery: "open",
    }).catch(() => null),
    listProjectWork(props.projectId, {
      limit: 1,
      offset: 0,
      kind: "pull-request",
      delivery: "open",
    }).catch(() => null),
    listProjectWork(props.projectId, {
      limit: 1,
      offset: 0,
      history: true,
      kind: "pull-request",
      delivery: "merged",
      from,
      to,
    }).catch(() => null),
    listProjectWork(props.projectId, {
      limit: 1,
      offset: 0,
      history: true,
      kind: "pull-request",
      delivery: "closed",
      from,
      to,
    }).catch(() => null),
    listIntegrations({
      limit: 1,
      offset: 0,
      status: "open",
      projectId: props.projectId,
    }).catch(() => null),
  ]);
  closedIssuesInPeriod.value = closedIssues?.total ?? null;
  openIssuesTotal.value = openIssues?.total ?? null;
  openPullRequestsTotal.value = openPrs?.total ?? null;
  mergedPrsInPeriod.value = mergedPrs?.total ?? null;
  closedPrsInPeriod.value = closedPrs?.total ?? null;
  openIntegrationPrs.value = openIntegrations?.total ?? null;
}

async function loadImpact() {
  loading.value = true;
  error.value = null;
  try {
    impact.value = await getDashboardImpact({
      projectId: props.projectId,
      range: impactRange.value,
    });
    await loadBacklogCounts();
  } catch (err) {
    impact.value = null;
    closedIssuesInPeriod.value = null;
    mergedPrsInPeriod.value = null;
    closedPrsInPeriod.value = null;
    openIssuesTotal.value = null;
    openPullRequestsTotal.value = null;
    openIntegrationPrs.value = null;
    error.value = err instanceof Error ? err.message : "Failed to load impact";
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.projectId,
  () => {
    impact.value = null;
    closedIssuesInPeriod.value = null;
    mergedPrsInPeriod.value = null;
    closedPrsInPeriod.value = null;
    openIssuesTotal.value = null;
    openPullRequestsTotal.value = null;
    openIntegrationPrs.value = null;
    void loadImpact();
  },
);

watch(impactRange, () => {
  void loadImpact();
});

bindStoreRefresh(operationsStore, loadImpact);
</script>

<template>
  <section class="impact-brief panel mb-7" aria-labelledby="impact-brief-heading">
    <div class="panel-header impact-brief__header">
      <div>
        <h2 id="impact-brief-heading">Project impact</h2>
        <p class="muted text-sm mt-1">{{ rangeLabel }} · outcomes vs prior period</p>
      </div>
      <div class="impact-brief__actions">
        <label class="sr-only" for="overview-impact-range">Impact time range</label>
        <select
          id="overview-impact-range"
          v-model="impactRange"
          class="select"
          aria-label="Impact time range"
        >
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">Lifetime</option>
        </select>
        <AppButton size="sm" :icon="ArrowRight" :to="projectImpactRoute">
          Full impact
        </AppButton>
      </div>
    </div>
    <div class="panel-body">
      <div v-if="loading" class="muted text-sm">Loading impact…</div>
      <div v-else-if="error" class="alert alert-error">{{ error }}</div>
      <div v-else-if="!hasAnySignal" class="muted text-sm">
        Impact data will appear after the project has completed enough runs to establish a
        reporting period.
      </div>
      <template v-else>
        <div class="impact-categories">
          <section
            v-if="showBacklog"
            class="impact-category"
            aria-labelledby="impact-backlog"
          >
            <h3 id="impact-backlog">Backlog</h3>
            <p class="muted text-sm impact-category__note">
              Open counts are current inventory. Closed issues and closed/merged PRs are counted in
              {{ rangeLabel.toLowerCase() }}. Links open the forge list when gojo has no in-app
              browser for that kind.
            </p>
            <div class="impact-category__metrics">
              <StatTile
                metric-key="work.issuesOpen"
                :value="displayOpenIssues"
                :href="openIssuesHref ?? undefined"
              />
              <StatTile
                metric-key="work.issuesClosed"
                :value="closedIssuesInPeriod ?? 0"
                :href="closedIssuesHref ?? undefined"
              />
              <StatTile
                metric-key="impact.prsOpen"
                :value="displayOpenPrs"
                :to="openPrsLink.to"
                :href="openPrsLink.href"
              />
              <StatTile
                metric-key="work.prsMerged"
                :value="mergedPrsInPeriod ?? 0"
                :to="mergedPrsLink.to"
                :href="mergedPrsLink.href"
              />
              <StatTile
                metric-key="work.prsClosed"
                :value="closedPrsInPeriod ?? 0"
                :href="closedPullsHref ?? undefined"
              />
            </div>
          </section>
          <section
            v-if="impact"
            class="impact-category"
            aria-labelledby="impact-delivery"
          >
            <h3 id="impact-delivery">Delivery</h3>
            <p class="muted text-sm impact-category__note">
              Merged work, reliability, and activity for {{ rangeLabel.toLowerCase() }}. Commits are
              activity indicators — not inherently positive impact.
            </p>
            <div class="impact-category__metrics impact-category__metrics--delivery">
              <StatTile
                metric-key="impact.mergedRuns"
                :value="impact.totals.mergedRuns"
                :previous="impact.previousTotals?.mergedRuns"
                :compare-label="impactCompareLabel()"
                :to="mergedRoute"
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
            </div>
          </section>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.impact-brief__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.impact-brief__header h2 {
  margin: 0;
  font-size: 1.05rem;
}

.impact-brief__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.impact-categories {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.impact-category h3 {
  margin: 0 0 0.65rem;
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.impact-category__note {
  margin: -0.35rem 0 0.65rem;
}

.impact-category__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
  gap: 0.75rem;
}

.impact-category__metrics--delivery {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

@media (max-width: 900px) {
  .impact-category__metrics--delivery {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .impact-category__metrics--delivery {
    grid-template-columns: 1fr;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
