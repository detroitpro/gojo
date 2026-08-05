<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { GitMerge } from "lucide-vue-next";

import AttentionSummary from "@/contexts/catalog/components/overview/AttentionSummary.vue";
import CurrentActivitySection from "@/contexts/catalog/components/overview/CurrentActivitySection.vue";
import RecentActivitySection from "@/contexts/catalog/components/overview/RecentActivitySection.vue";
import ProjectImpactSection from "@/contexts/catalog/components/overview/ProjectImpactBrief.vue";
import { projectShellKey } from "@/contexts/catalog/project-shell";
import { runAgent } from "@/contexts/catalog/contract";
import {
  getProjectWorkStatus,
  listProjectSources,
  listProjectWork,
  recheckWorkItem,
  refreshProjectSource,
  resolveWorkItem,
  useWorkStore,
} from "@/contexts/work/contract";
import type { ProjectSource, WorkItem, WorkStatus } from "@/contexts/work/types";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import {
  buildProgressSummary,
  collapseHistoryForOverview,
  defaultActivityPreset,
  inventoryAvailableWork,
  isActiveWork,
  isAttentionWork,
  presentCompletedWork,
  readLastCheckAt,
  repositoryBrowseUrl,
  resolveActivityRange,
  summarizeCompletedWork,
  writeLastCheckAt,
  type ActivityRangePreset,
} from "@/kernel/project-overview";
import { attentionPrimaryAction } from "@/kernel/work-attention";
import { bindStoreRefresh } from "@/platform/bind-store-refresh";
import AppButton from "@/ui/AppButton.vue";
import ConfirmDialog from "@/ui/ConfirmDialog.vue";
import { useRouter } from "vue-router";

const shellContext = inject(projectShellKey);
if (!shellContext) {
  throw new Error("ProjectOverviewView requires ProjectShellView");
}
const shell = shellContext;

const route = useRoute();
const router = useRouter();

const { project, projectId, dataVersion } = shell;

const activeItems = ref<WorkItem[]>([]);
const historyItems = ref<WorkItem[]>([]);
const workStatus = ref<WorkStatus | null>(null);
const projectSources = ref<ProjectSource[]>([]);
const loadingActive = ref(true);
const loadingHistory = ref(true);
const historyError = ref<string | null>(null);
const activeError = ref<string | null>(null);

const rangePreset = ref<ActivityRangePreset>("24h");
const customFrom = ref("");
const customTo = ref("");
const progressTick = ref(0);

const attentionBusyId = ref("");
const resolveOpen = ref(false);
const resolveTarget = ref<WorkItem | null>(null);
const mergeBusy = ref(false);

const mergeBabysitter = computed(
  () =>
    shell.projectAgents.value.find(
      (agent) => agent.name === "maintain-merge" && agent.enabled,
    ) ?? null,
);

const hasLastCheck = computed(() => Boolean(readLastCheckAt(projectId.value)));

const activityRange = computed(() => {
  const fromLocal = customFrom.value ? new Date(customFrom.value).toISOString() : null;
  const toLocal = customTo.value ? new Date(customTo.value).toISOString() : null;
  return resolveActivityRange(rangePreset.value, projectId.value, {
    customFrom: fromLocal,
    customTo: toLocal,
  });
});

const sourceWebUrls = computed(() => {
  const map = new Map<string, string | null>();
  for (const source of projectSources.value) {
    map.set(source.id, source.webUrl);
  }
  return map;
});

/** Exceptions only (approval / blocked / sync-error / stale) — not open backlog. */
const attentionItems = computed(() => activeItems.value.filter(isAttentionWork));

const availableWork = computed(() => inventoryAvailableWork(activeItems.value));

const repositoryWebUrl = computed(() => {
  const fromSource = projectSources.value.find((source) => source.webUrl)?.webUrl;
  return (
    repositoryBrowseUrl(fromSource) ??
    repositoryBrowseUrl(project.value?.remoteUrl) ??
    null
  );
});

const completedPresentations = computed(() =>
  collapseHistoryForOverview(historyItems.value).map((item) => presentCompletedWork(item)),
);

const activityMetrics = computed(() => summarizeCompletedWork(historyItems.value));

const activeCount = computed(() => activeItems.value.filter(isActiveWork).length);

const progressText = computed(() => {
  void progressTick.value;
  return buildProgressSummary({
    rangeLabel: activityRange.value.label,
    completed: historyItems.value,
    attentionCount: attentionItems.value.length,
    activeCount: activeCount.value,
    projectEnabled: project.value?.enabled !== false,
  }).text;
});

const emptyMessage = computed(
  () => `No work was completed during ${activityRange.value.label.toLowerCase()}.`,
);

const emptyHint = computed(() => {
  if (project.value?.enabled === false) {
    return "This project is disabled — new scheduled and API runs are blocked.";
  }
  if (activeError.value) return null;
  if ((workStatus.value?.needsAttention ?? 0) > 0) {
    return "There are items that need attention above.";
  }
  if ((project.value?.enabledScheduleCount ?? 0) === 0) {
    return "No enabled schedules are configured for this project.";
  }
  return "When agents complete runs or merge delivery work, outcomes will appear here.";
});

const openPrTotal = computed(() => workStatus.value?.verifiedOpen ?? 0);

async function loadActive() {
  loadingActive.value = true;
  activeError.value = null;
  try {
    const [page, status, sources] = await Promise.all([
      listProjectWork(projectId.value, { limit: MAX_PAGE_LIMIT, offset: 0 }),
      getProjectWorkStatus(projectId.value),
      listProjectSources(projectId.value),
    ]);
    activeItems.value = page.items;
    workStatus.value = status;
    projectSources.value = sources;
    shell.setOpenPrTotal(status.verifiedOpen);
  } catch (err) {
    activeItems.value = [];
    workStatus.value = null;
    projectSources.value = [];
    shell.setOpenPrTotal(0);
    activeError.value = err instanceof Error ? err.message : "Failed to load active work";
  } finally {
    loadingActive.value = false;
  }
}

async function loadHistory() {
  loadingHistory.value = true;
  historyError.value = null;
  try {
    const range = activityRange.value;
    const page = await listProjectWork(projectId.value, {
      limit: MAX_PAGE_LIMIT,
      offset: 0,
      history: true,
      from: range.from,
      to: range.to,
    });
    historyItems.value = page.items;
  } catch (err) {
    historyItems.value = [];
    historyError.value = err instanceof Error ? err.message : "Failed to load completed work";
  } finally {
    loadingHistory.value = false;
  }
}

async function loadAll() {
  await Promise.all([loadActive(), loadHistory()]);
}

async function runAttentionRecheck(item: WorkItem) {
  attentionBusyId.value = item.id;
  shell.setError("");
  shell.setNotice("");
  try {
    const result = await recheckWorkItem(item.id);
    const detail = result.detail ? ` — ${result.detail}` : "";
    if (result.status === "terminal") {
      shell.setNotice(`Verified ${result.work.title} as closed${detail}`);
    } else if (result.status === "unresolved") {
      shell.setNotice(`Still open: ${result.work.title}${detail}`);
    } else {
      shell.setNotice(`Updated ${result.work.title}${detail}`);
    }
    await loadAll();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : "Recheck failed");
  } finally {
    attentionBusyId.value = "";
  }
}

async function runAttentionRetrySource(item: WorkItem) {
  if (!item.sourceId) return;
  attentionBusyId.value = item.id;
  shell.setError("");
  shell.setNotice("");
  try {
    await refreshProjectSource(projectId.value, item.sourceId);
    shell.setNotice("Source refresh queued");
    await loadAll();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : "Source refresh failed");
  } finally {
    attentionBusyId.value = "";
  }
}

async function onPrimaryAttentionAction(item: WorkItem) {
  const sourceUrl = item.sourceId ? sourceWebUrls.value.get(item.sourceId) : null;
  const action = attentionPrimaryAction(item, sourceUrl);
  if (!action || action.kind === "route" || action.kind === "href") return;
  if (action.id === "recheck-item") {
    await runAttentionRecheck(item);
    return;
  }
  if (action.id === "retry-source") {
    await runAttentionRetrySource(item);
  }
}

async function onAttentionMenuAction(item: WorkItem, actionId: string) {
  if (actionId === "recheck-item") {
    await runAttentionRecheck(item);
    return;
  }
  if (actionId === "retry-source") {
    await runAttentionRetrySource(item);
    return;
  }
  if (actionId === "resolve") {
    resolveTarget.value = item;
    resolveOpen.value = true;
    return;
  }
  if (actionId === "open-source") {
    const url = item.webUrl ?? (item.sourceId ? sourceWebUrls.value.get(item.sourceId) : null);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function confirmResolve() {
  const target = resolveTarget.value;
  if (!target) return;
  attentionBusyId.value = target.id;
  shell.setError("");
  try {
    await resolveWorkItem(target.id);
    shell.setNotice(`Resolved ${target.title}`);
    resolveOpen.value = false;
    resolveTarget.value = null;
    await loadAll();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : "Resolve failed");
  } finally {
    attentionBusyId.value = "";
  }
}

async function runMergeBabysitter() {
  const agent = mergeBabysitter.value;
  if (!agent) return;
  mergeBusy.value = true;
  shell.setError("");
  try {
    const run = await runAgent(agent.id);
    await router.push({ name: "run-detail", params: { id: run.id } });
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : "Failed to enqueue merge babysitter");
    mergeBusy.value = false;
  }
}

function markChecked() {
  writeLastCheckAt(projectId.value);
}

watch(dataVersion, () => {
  void loadAll();
});

watch(
  () => projectId.value,
  () => {
    rangePreset.value = defaultActivityPreset(projectId.value);
    activeItems.value = [];
    historyItems.value = [];
    void loadAll();
  },
);

watch(
  [rangePreset, customFrom, customTo],
  () => {
    void loadHistory();
  },
);

watch(
  () => route.hash,
  (hash) => {
    if (hash === "#delivery" || hash === "#open-prs" || hash === "#attention") {
      requestAnimationFrame(() => {
        document.getElementById("attention")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  },
  { immediate: true },
);

const workStore = useWorkStore();
bindStoreRefresh(workStore, loadAll);

onMounted(() => {
  rangePreset.value = defaultActivityPreset(projectId.value);
  void loadAll();
  markChecked();
});

onUnmounted(() => {
  markChecked();
});
</script>

<template>
  <template v-if="project">
    <div
      v-if="project.enabled === false"
      class="alert alert-error mb-5"
      role="status"
    >
      Project disabled — new scheduled, work, and API runs are blocked until Enable or Sync.
    </div>

    <div id="attention">
      <AttentionSummary
        :items="attentionItems"
        :source-web-urls="sourceWebUrls"
        :busy-id="attentionBusyId"
        :show-healthy="!loadingActive && !activeError"
        @primary-action="onPrimaryAttentionAction"
        @menu-action="onAttentionMenuAction"
      />
    </div>

    <div
      v-if="mergeBabysitter && openPrTotal > 0"
      class="delivery-nudge mb-5"
    >
      <p class="text-sm muted">
        {{ openPrTotal }} verified pull request{{ openPrTotal === 1 ? "" : "s" }} awaiting merge
        (optional merge babysitter).
      </p>
      <AppButton
        variant="primary"
        size="sm"
        :icon="GitMerge"
        :loading="mergeBusy"
        loading-label="Enqueueing…"
        @click="runMergeBabysitter()"
      >
        Run merge babysitter
      </AppButton>
    </div>

    <div v-if="activeError" class="alert alert-error mb-5">{{ activeError }}</div>

    <div class="overview-layout">
      <div class="overview-layout__main">
        <RecentActivitySection
          v-model:preset="rangePreset"
          v-model:custom-from="customFrom"
          v-model:custom-to="customTo"
          :range-label="activityRange.label"
          :has-last-check="hasLastCheck"
          :metrics="activityMetrics"
          :items="completedPresentations"
          :loading="loadingHistory"
          :error="historyError"
          :empty-message="emptyMessage"
          :empty-hint="emptyHint"
          :progress-text="progressText"
          :project-id="projectId"
          @retry="loadHistory"
          @regenerate="progressTick += 1"
        />

        <ProjectImpactSection
          :project-id="projectId"
          :available-work="availableWork"
          :repository-web-url="repositoryWebUrl"
        />

        <CurrentActivitySection :items="activeItems" />
      </div>
    </div>

    <ConfirmDialog
      :open="resolveOpen"
      title="Mark work resolved?"
      confirm-label="Mark resolved"
      danger
      :busy="Boolean(resolveTarget && attentionBusyId === resolveTarget.id)"
      @close="resolveOpen = false; resolveTarget = null"
      @confirm="confirmResolve"
    >
      <p>
        Remove <strong>{{ resolveTarget?.title }}</strong> from Needs attention and keep it in
        History.
      </p>
      <p class="muted mt-3">
        This does not invent a merged or closed delivery. If the source later reports the work as
        active again, gojo will restore it.
      </p>
    </ConfirmDialog>
  </template>
</template>

<style scoped>
.overview-layout {
  display: block;
}

.delivery-nudge {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.delivery-nudge p {
  margin: 0;
}

.inline-icon {
  display: inline;
  vertical-align: -0.15em;
  margin-right: 0.35rem;
}

.mb-5 {
  margin-bottom: 1.25rem;
}
</style>
