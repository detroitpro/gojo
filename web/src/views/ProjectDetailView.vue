<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import {
  deleteProject,
  getDashboardImpact,
  getProject,
  getProjectDoctor,
  getProjectWorkStatus,
  listAgents,
  listProjectSources,
  listProjectWork,
  recheckWorkItem,
  refreshProjectSource,
  resolveWorkItem,
  runAgent,
  syncProject,
} from "@/api";
import ActionMenu, { type ActionMenuItem } from "@/components/ActionMenu.vue";
import AppButton from "@/components/AppButton.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useLiveRefresh } from "@/composables/useLiveQuery";
import { useSoftLoading } from "@/composables/useSoftLoading";
import AttentionBadge from "@/components/status/AttentionBadge.vue";
import DeliveryBadge from "@/components/status/DeliveryBadge.vue";
import ExecutionBadge from "@/components/status/ExecutionBadge.vue";
import ProvenanceBadge from "@/components/status/ProvenanceBadge.vue";
import SyncStateBadge from "@/components/status/SyncStateBadge.vue";
import VerificationBadge from "@/components/status/VerificationBadge.vue";
import WorkKindBadge from "@/components/status/WorkKindBadge.vue";
import WorkResultBadge from "@/components/status/WorkResultBadge.vue";
import HealthBadge from "@/components/status/HealthBadge.vue";
import StatGrid from "@/components/StatGrid.vue";
import StatTile from "@/components/StatTile.vue";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/pagination";
import { computeProjectHealth, parseManifestView } from "@/lib/project-manifest";
import {
  attentionMenuItems,
  attentionPrimaryAction,
  workExternalHref,
} from "@/lib/work-attention";
import {
  collapseHistoryTimeline,
  workAgentProfileLabel,
  workHistoryHref,
  workPrimaryLabel,
  workSecondaryLabel,
} from "@/lib/work-display";
import { compareLabel } from "@/lib/stat-metrics";
import { isVerifiedActiveDelivery } from "@/lib/work-visibility";
import {
  Calendar,
  ExternalLink,
  GitMerge,
  ListTodo,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-vue-next";
import type {
  Agent,
  DashboardImpact,
  Project,
  ProjectDoctorResult,
  ProjectSource,
  ProjectSyncResult,
  WorkItem,
  WorkStatus,
} from "@/types";

const route = useRoute();
const router = useRouter();

const project = ref<Project | null>(null);
const doctor = ref<ProjectDoctorResult | null>(null);
const lastSync = ref<ProjectSyncResult | null>(null);
const projectAgents = ref<Agent[]>([]);
const openPrTotal = ref(0);
const workItems = ref<WorkItem[]>([]);
const historyItems = ref<WorkItem[]>([]);
const historyTotal = ref(0);
const workStatus = ref<WorkStatus | null>(null);
const projectSources = ref<ProjectSource[]>([]);
const mergeBusy = ref(false);
const { loading, begin: beginLoad, end: endLoad, reset: resetLoad } = useSoftLoading();
const busy = ref(false);
const attentionBusyId = ref("");
const error = ref("");
const notice = ref("");
const removeOpen = ref(false);
const resolveOpen = ref(false);
const resolveTarget = ref<WorkItem | null>(null);

type ImpactRange = "30d" | "90d" | "all";
const impact = ref<DashboardImpact | null>(null);
const impactRange = ref<ImpactRange>("30d");
/** Agent ids whose impact rows are hidden; empty = all visible. */
const hiddenAgentIds = ref<Set<string>>(new Set());

const projectId = computed(() => route.params.id as string);

function impactCompareLabel(): string {
  return compareLabel("previousWindow", impact.value?.range);
}

function impactWindowQuery(base: Record<string, string> = {}): Record<string, string> {
  const query: Record<string, string> = {
    ...base,
    projectId: projectId.value,
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

function categoryRoute(category: string) {
  return {
    name: "impact" as const,
    query: impactWindowQuery({ category }),
  };
}

function workCompareLabel(): string {
  return compareLabel("asOf", workStatus.value?.compareWindow);
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
      projectId: projectId.value,
      range: impactRange.value,
    });
    // Drop hide state for agents no longer present in this range.
    const known = new Set(impactAgents.value.map((agent) => agent.id));
    const next = new Set([...hiddenAgentIds.value].filter((id) => known.has(id)));
    if (next.size !== hiddenAgentIds.value.size) {
      hiddenAgentIds.value = next;
    }
  } catch {
    impact.value = null;
  }
}

const manifest = computed(() => parseManifestView(project.value?.manifestJson));

const health = computed(() =>
  project.value
    ? computeProjectHealth(project.value, doctor.value)
    : { score: null, level: "missing" as const, label: "…" },
);

const agentsByName = computed(() => {
  const map = new Map<string, Agent>();
  for (const agent of projectAgents.value) {
    map.set(agent.name, agent);
  }
  return map;
});

const mergeBabysitter = computed(() =>
  projectAgents.value.find((agent) => agent.name === "maintain-merge" && agent.enabled) ?? null,
);

function scrollToOpenPrs() {
  document.getElementById("delivery")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const nowWork = computed(() =>
  workItems.value.filter((item) => item.execution !== "none" && item.execution !== "terminal"),
);
const attentionWork = computed(() =>
  workItems.value.filter((item) => item.attention !== "none" && item.resolution == null),
);
const deliveryWork = computed(() =>
  workItems.value.filter(isVerifiedActiveDelivery),
);
const historyRows = computed(() => collapseHistoryTimeline(historyItems.value));
const historyTopLevelCount = computed(
  () => historyRows.value.filter((row) => !row.nested).length,
);

const sourceNames = computed(
  () => new Map(projectSources.value.map((source) => [source.id, source.displayName])),
);
const sourceWebUrls = computed(
  () => new Map(projectSources.value.map((source) => [source.id, source.webUrl])),
);

function sourceLabel(item: WorkItem): string {
  if (item.sourceId) return sourceNames.value.get(item.sourceId) ?? item.sourceId;
  return item.provenance === "gojo-agent" ? "gojo" : "local";
}

function sourceWebUrl(item: WorkItem): string | null {
  if (!item.sourceId) return null;
  return sourceWebUrls.value.get(item.sourceId) ?? null;
}

function observedLabel(item: WorkItem): string {
  if (!item.observedAt) return "not observed";
  return new Date(item.observedAt).toLocaleString();
}

function attentionHref(item: WorkItem): string | null {
  return workExternalHref(item, sourceWebUrl(item));
}

function historyRunId(item: WorkItem): string | null {
  const href = workHistoryHref(item);
  return href?.type === "run" ? href.id : null;
}

function historyExternalUrl(item: WorkItem): string | null {
  const href = workHistoryHref(item);
  return href?.type === "external" ? href.url : null;
}

function primaryAttentionAction(item: WorkItem) {
  return attentionPrimaryAction(item, sourceWebUrl(item));
}

function attentionActions(item: WorkItem): ActionMenuItem[] {
  return attentionMenuItems(item, sourceWebUrl(item));
}

async function runAttentionRecheck(item: WorkItem) {
  attentionBusyId.value = item.id;
  error.value = "";
  notice.value = "";
  try {
    const result = await recheckWorkItem(item.id);
    await loadWork();
    if (result.status === "terminal") {
      notice.value = `Verified ${item.title} as ${result.work.delivery}`;
    } else if (result.status === "active") {
      notice.value = `${item.title} is active in the source again`;
    } else {
      error.value =
        result.detail ??
        "Source could not confirm the final state. You can open it upstream or mark it resolved.";
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Recheck failed";
  } finally {
    attentionBusyId.value = "";
  }
}

async function runAttentionRetrySource(item: WorkItem) {
  if (!item.sourceId) return;
  attentionBusyId.value = item.id;
  error.value = "";
  notice.value = "";
  try {
    await refreshProjectSource(projectId.value, item.sourceId);
    await loadWork();
    notice.value = `Retried source ${sourceLabel(item)}`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Source retry failed";
  } finally {
    attentionBusyId.value = "";
  }
}

function openResolveDialog(item: WorkItem) {
  resolveTarget.value = item;
  resolveOpen.value = true;
}

async function confirmResolve() {
  const item = resolveTarget.value;
  if (!item) return;
  attentionBusyId.value = item.id;
  error.value = "";
  notice.value = "";
  try {
    await resolveWorkItem(item.id, {
      note: "Marked resolved from project Needs attention",
    });
    resolveOpen.value = false;
    resolveTarget.value = null;
    await loadWork();
    notice.value = `Resolved ${item.title}. It will reappear if the source reports it active again.`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Resolve failed";
  } finally {
    attentionBusyId.value = "";
  }
}

async function onAttentionAction(item: WorkItem, actionId: string) {
  if (actionId === "recheck-item") {
    await runAttentionRecheck(item);
    return;
  }
  if (actionId === "retry-source") {
    await runAttentionRetrySource(item);
    return;
  }
  if (actionId === "resolve") {
    openResolveDialog(item);
    return;
  }
  if (actionId === "open-source") {
    const href = attentionHref(item);
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  }
}

async function runPrimaryAttentionAction(item: WorkItem) {
  const action = primaryAttentionAction(item);
  if (!action || action.kind === "route" || action.kind === "href") return;
  if (action.id === "recheck-item") {
    await runAttentionRecheck(item);
    return;
  }
  if (action.id === "retry-source") {
    await runAttentionRetrySource(item);
  }
}

async function loadWork() {
  try {
    const [page, history, status, sources] = await Promise.all([
      listProjectWork(projectId.value, { limit: MAX_PAGE_LIMIT, offset: 0 }),
      listProjectWork(projectId.value, {
        limit: DEFAULT_PAGE_LIMIT,
        offset: 0,
        history: true,
      }),
      getProjectWorkStatus(projectId.value),
      listProjectSources(projectId.value),
    ]);
    workItems.value = page.items;
    historyItems.value = history.items;
    historyTotal.value = history.total;
    workStatus.value = status;
    projectSources.value = sources;
    openPrTotal.value = status.verifiedOpen;
  } catch {
    workItems.value = [];
    historyItems.value = [];
    historyTotal.value = 0;
    workStatus.value = null;
    projectSources.value = [];
    openPrTotal.value = 0;
  }
}

async function runMergeBabysitter() {
  const agent = mergeBabysitter.value;
  if (!agent) {
    return;
  }
  mergeBusy.value = true;
  error.value = "";
  try {
    const run = await runAgent(agent.id);
    await router.push({ name: "run-detail", params: { id: run.id } });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to enqueue merge babysitter";
    mergeBusy.value = false;
  }
}

async function load() {
  const initial = beginLoad();
  error.value = "";
  try {
    project.value = await getProject(projectId.value);
    doctor.value = await getProjectDoctor(projectId.value);
    const agents = await listAgents({
      limit: MAX_PAGE_LIMIT,
      offset: 0,
      projectId: projectId.value,
    });
    projectAgents.value = agents.items;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load project";
    if (initial) {
      project.value = null;
      doctor.value = null;
      projectAgents.value = [];
    }
  } finally {
    endLoad(initial);
    if (route.hash === "#open-prs") {
      requestAnimationFrame(() => scrollToOpenPrs());
    }
  }
}

async function runSync() {
  if (!project.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await syncProject(project.value.id);
    project.value = result.project;
    lastSync.value = result.sync;
    const path = result.sync.manifestPath
      ? result.sync.manifestPath.split(/[/\\]/).slice(-2).join("/")
      : "no manifest file";
    notice.value = `Synced from ${path} — ${result.sync.profiles} profiles, ${result.sync.agents} agents, ${result.sync.schedules} schedules`;
    doctor.value = await getProjectDoctor(project.value.id);
    const agents = await listAgents({
      limit: MAX_PAGE_LIMIT,
      offset: 0,
      projectId: project.value.id,
    });
    projectAgents.value = agents.items;
    await loadWork();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Sync failed";
  } finally {
    busy.value = false;
  }
}

async function confirmRemove() {
  if (!project.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await deleteProject(project.value.id);
    removeOpen.value = false;
    await router.push({ name: "projects" });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Remove failed";
    busy.value = false;
  }
}

watch(projectId, () => {
  resetLoad();
  project.value = null;
  doctor.value = null;
  projectAgents.value = [];
  workItems.value = [];
  historyItems.value = [];
  historyTotal.value = 0;
  workStatus.value = null;
  projectSources.value = [];
  impact.value = null;
  lastSync.value = null;
  notice.value = "";
  hiddenAgentIds.value = new Set();
  void load();
  void loadImpact();
  void loadWork();
});

watch(impactRange, () => {
  void loadImpact();
});

watch(
  () => route.hash,
  (hash) => {
    if (hash === "#open-prs" && !loading.value) {
      requestAnimationFrame(() => scrollToOpenPrs());
    }
  },
);

useLiveRefresh({
  topics: ["projects", "agents"],
  projectId,
  refresh: load,
});
useLiveRefresh({
  topics: ["work", "sources"],
  projectId,
  refresh: loadWork,
});
useLiveRefresh({
  topics: ["impact"],
  projectId,
  refresh: loadImpact,
});
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <RouterLink :to="{ name: 'projects' }" class="muted text-sm">← Projects</RouterLink>
        <h1 class="mt-2">{{ project?.name ?? "Project" }}</h1>
        <div v-if="project" class="subtitle mono">{{ project.id }}</div>
      </div>
      <div class="toolbar">
        <AppButton
          variant="primary"
          size="sm"
          :icon="RefreshCw"
          :loading="busy"
          loading-label="Syncing…"
          :disabled="!project"
          @click="runSync()"
        >
          Sync
        </AppButton>
        <AppButton
          variant="danger"
          size="sm"
          :icon="Trash2"
          :disabled="busy || !project"
          @click="removeOpen = true"
        >
          Remove
        </AppButton>
      </div>
    </header>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="notice" class="alert alert-success">{{ notice }}</div>

    <div v-if="loading && !project" class="empty">Loading…</div>
    <template v-else-if="project">
      <section class="panel mb-7">
        <div class="panel-header">
          Overview
          <HealthBadge :level="health.level" :label="health.label" />
        </div>
        <div class="panel-body">
          <dl class="project-meta">
            <div>
              <dt>Repository</dt>
              <dd class="mono">{{ project.repoPath }}</dd>
            </div>
            <div v-if="project.remoteUrl">
              <dt>Remote</dt>
              <dd>
                <a
                  :href="project.remoteUrl"
                  class="entity-name"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ project.remoteUrl }}
                </a>
              </dd>
            </div>
            <div>
              <dt>Default branch</dt>
              <dd class="mono">{{ project.defaultBranch }}</dd>
            </div>
            <div>
              <dt>Configured</dt>
              <dd>
                {{ project.enabledAgentCount }}/{{ project.agentCount }} agents ·
                {{ project.enabledScheduleCount }}/{{ project.scheduleCount }} schedules
              </dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd class="mono">{{ new Date(project.updatedAt).toLocaleString() }}</dd>
            </div>
          </dl>

          <div class="toolbar mt-5">
            <AppButton
              size="sm"
              :icon="ListTodo"
              :to="{ name: 'agents', query: { projectId: project.id } }"
            >
              Agents
            </AppButton>
            <AppButton
              size="sm"
              :icon="Calendar"
              :to="{ name: 'schedules', query: { projectId: project.id } }"
            >
              Schedules
            </AppButton>
            <AppButton
              size="sm"
              :icon="Play"
              :to="{ name: 'runs', query: { projectId: project.id } }"
            >
              Runs
            </AppButton>
          </div>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header impact-header">
          <span>Project command center</span>
          <span class="muted text-sm">
            {{
              workStatus?.asOf
                ? `Observed ${new Date(workStatus.asOf).toLocaleString()}`
                : "Awaiting source observations"
            }}
          </span>
        </div>
        <div class="panel-body">
          <StatGrid>
            <StatTile
              metric-key="work.working"
              :value="workStatus?.working ?? 0"
              :previous="workStatus?.previous?.working"
              :compare-label="workCompareLabel()"
            />
            <StatTile
              metric-key="work.queued"
              :value="workStatus?.queued ?? 0"
              :previous="workStatus?.previous?.queued"
              :compare-label="workCompareLabel()"
            />
            <StatTile
              metric-key="work.needsAttention"
              :value="workStatus?.needsAttention ?? 0"
              :previous="workStatus?.previous?.needsAttention"
              :compare-label="workCompareLabel()"
            />
            <StatTile
              metric-key="work.verifiedOpen"
              :value="workStatus?.verifiedOpen ?? 0"
              :previous="workStatus?.previous?.verifiedOpen"
              :compare-label="workCompareLabel()"
            />
            <StatTile
              metric-key="work.staleOpen"
              :value="workStatus?.staleOpen ?? 0"
              :previous="workStatus?.previous?.staleOpen"
              :compare-label="workCompareLabel()"
            />
          </StatGrid>
          <div class="source-health mt-5">
            <span
              v-for="source in projectSources"
              :key="source.id"
              class="source-health__item"
              :title="source.lastError ?? `Observed ${source.observedAt ?? 'never'}`"
            >
              <span class="muted text-sm">{{ source.displayName }}</span>
              <SyncStateBadge :sync-state="source.syncState" :show-label="false" />
            </span>
          </div>
        </div>
      </section>

      <section class="list-section">
        <div class="list-section__header">
          <h2 class="list-section__title">Now</h2>
          <span class="list-section__meta">{{ nowWork.length }}</span>
        </div>
        <div v-if="nowWork.length === 0" class="muted text-sm">No active or queued work</div>
        <div v-else class="table-wrap">
          <table class="data">
            <thead><tr><th>Work</th><th>Agent / profile</th><th>Phase</th><th>Platform / repo</th><th>Activity</th></tr></thead>
            <tbody>
              <tr v-for="item in nowWork" :key="item.id">
                <td>
                  <RouterLink
                    v-if="item.kind === 'run' && item.nativeKey"
                    :to="{ name: 'run-detail', params: { id: item.nativeKey } }"
                    class="entity-name"
                  >{{ workPrimaryLabel(item) }}</RouterLink>
                  <a
                    v-else-if="item.webUrl"
                    :href="item.webUrl"
                    class="entity-name"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ workPrimaryLabel(item) }}</a>
                  <span v-else>{{ workPrimaryLabel(item) }}</span>
                  <div v-if="workSecondaryLabel(item)" class="muted text-sm">
                    {{ workSecondaryLabel(item) }}
                  </div>
                </td>
                <td>{{ workAgentProfileLabel(item) }}</td>
                <td><ExecutionBadge :execution="item.execution" /></td>
                <td>{{ sourceLabel(item) }}</td>
                <td class="mono muted">{{ observedLabel(item) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="attentionWork.length > 0" class="list-section">
        <div class="list-section__header">
          <h2 class="list-section__title">Needs attention</h2>
          <span class="list-section__meta">{{ attentionWork.length }}</span>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Work</th>
                <th>Reason</th>
                <th>Source</th>
                <th>Last observation</th>
                <th>Recommended</th>
                <th class="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in attentionWork" :key="item.id">
                <td>
                  <RouterLink
                    v-if="item.kind === 'run' && item.nativeKey"
                    :to="{ name: 'run-detail', params: { id: item.nativeKey } }"
                    class="entity-name"
                  >{{ item.title }}</RouterLink>
                  <a
                    v-else-if="attentionHref(item)"
                    :href="attentionHref(item)!"
                    class="entity-name"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ item.title }}</a>
                  <span v-else>{{ item.title }}</span>
                  <div v-if="item.summary" class="muted text-sm">{{ item.summary }}</div>
                </td>
                <td>
                  <AttentionBadge :attention="item.attention" />
                  <div v-if="item.lastError" class="muted text-sm">{{ item.lastError }}</div>
                </td>
                <td>{{ sourceLabel(item) }}</td>
                <td class="mono muted">{{ observedLabel(item) }}</td>
                <td>
                  <AppButton
                    v-if="primaryAttentionAction(item)?.kind === 'route'"
                    variant="primary"
                    size="sm"
                    :icon="Play"
                    :to="(primaryAttentionAction(item) as Extract<ReturnType<typeof primaryAttentionAction>, { kind: 'route' }>).to"
                  >
                    {{ primaryAttentionAction(item)?.label }}
                  </AppButton>
                  <AppButton
                    v-else-if="primaryAttentionAction(item)?.kind === 'href'"
                    size="sm"
                    :icon="ExternalLink"
                    :href="(primaryAttentionAction(item) as Extract<ReturnType<typeof primaryAttentionAction>, { kind: 'href' }>).href"
                    target="_blank"
                  >
                    {{ primaryAttentionAction(item)?.label }}
                  </AppButton>
                  <AppButton
                    v-else-if="primaryAttentionAction(item)?.kind === 'action'"
                    variant="primary"
                    size="sm"
                    :icon="RefreshCw"
                    :loading="attentionBusyId === item.id"
                    loading-label="Working…"
                    @click="runPrimaryAttentionAction(item)"
                  >
                    {{ primaryAttentionAction(item)?.label }}
                  </AppButton>
                  <span v-else class="muted text-sm">No action available</span>
                </td>
                <td class="actions-col">
                  <ActionMenu
                    :items="attentionActions(item)"
                    :disabled="attentionBusyId === item.id"
                    :label="`Actions for ${item.title}`"
                    @select="(id) => onAttentionAction(item, id)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="delivery" class="panel mb-7">
        <div class="panel-header impact-header">
          <span>
            Delivery
            <span class="list-section__meta">· {{ deliveryWork.length }}</span>
          </span>
          <AppButton
            v-if="mergeBabysitter && openPrTotal > 0"
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
        <div class="panel-body" :class="{ 'panel-body--flush-table': deliveryWork.length > 0 }">
          <div v-if="deliveryWork.length === 0" class="muted text-sm">No active delivery work</div>
          <div v-else class="table-wrap">
            <table class="data">
              <thead><tr><th>Work</th><th>State</th><th>Provenance</th><th>Source</th><th>Observed</th></tr></thead>
              <tbody>
                <tr v-for="item in deliveryWork" :key="item.id">
                  <td>
                    <a
                      v-if="item.webUrl"
                      :href="item.webUrl"
                      class="entity-name"
                      target="_blank"
                      rel="noopener noreferrer"
                    >{{ item.title }}</a>
                    <span v-else>{{ item.title }}</span>
                    <div v-if="item.labels.length > 0" class="muted text-sm">
                      {{ item.labels.join(" · ") }}
                    </div>
                  </td>
                  <td><DeliveryBadge :delivery="item.delivery" /></td>
                  <td><ProvenanceBadge :provenance="item.provenance" /></td>
                  <td>{{ sourceLabel(item) }}</td>
                  <td class="mono muted">
                    {{ observedLabel(item) }}
                    <SyncStateBadge :sync-state="item.syncState" :show-label="false" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="list-section">
        <div class="list-section__header">
          <div>
            <h2 class="list-section__title">History</h2>
            <p class="muted text-sm mt-1">
              Completed runs and verified merged/closed delivery
            </p>
          </div>
          <span class="list-section__meta">
            {{
              historyTopLevelCount === 0
                ? "0"
                : `latest ${historyTopLevelCount}${historyTotal > historyItems.length ? ` of ${historyTotal}` : ""}`
            }}
          </span>
        </div>
        <div v-if="historyRows.length === 0" class="muted text-sm">No completed work yet</div>
        <div v-else class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Type</th>
                <th>Work</th>
                <th>Agent / profile</th>
                <th>Result</th>
                <th>Platform / repo</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in historyRows"
                :key="row.nested ? `${row.parentId}:${row.item.id}` : row.item.id"
                :class="{ 'history-row--nested': row.nested }"
              >
                <td><WorkKindBadge :kind="row.item.kind" /></td>
                <td :class="{ 'history-work--nested': row.nested }">
                  <RouterLink
                    v-if="historyRunId(row.item)"
                    :to="{ name: 'run-detail', params: { id: historyRunId(row.item)! } }"
                    class="entity-name"
                  >{{ workPrimaryLabel(row.item) }}</RouterLink>
                  <a
                    v-else-if="historyExternalUrl(row.item)"
                    :href="historyExternalUrl(row.item)!"
                    class="entity-name"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ workPrimaryLabel(row.item) }}</a>
                  <span v-else>{{ workPrimaryLabel(row.item) }}</span>
                  <div v-if="workSecondaryLabel(row.item)" class="muted text-sm">
                    {{ workSecondaryLabel(row.item) }}
                  </div>
                </td>
                <td>{{ workAgentProfileLabel(row.item) }}</td>
                <td><WorkResultBadge :item="row.item" /></td>
                <td>{{ sourceLabel(row.item) }}</td>
                <td class="mono muted">
                  {{
                    new Date(
                      row.item.resolvedAt ?? row.item.completedAt ?? row.item.updatedAt,
                    ).toLocaleString()
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="impact" class="panel mb-7">
        <div class="panel-header impact-header">
          <span>Impact</span>
          <select
            id="project-impact-range"
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
              :value="openPrTotal"
              :previous="impact.previousTotals?.prsOpen"
              :compare-label="impactCompareLabel()"
              :href="openPrTotal > 0 ? '#delivery' : undefined"
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

          <div v-if="impactAgents.length > 0" class="impact-task-toggles">
            <span class="muted text-sm">Agents</span>
            <label
              v-for="agent in impactAgents"
              :key="agent.id"
              class="impact-task-toggle"
            >
              <input
                type="checkbox"
                :checked="isAgentVisible(agent.id)"
                @change="toggleAgentVisibility(agent.id)"
              />
              {{ agent.name }}
            </label>
          </div>

          <div v-if="visibleImpactItems.length > 0" class="table-wrap impact-recent">
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
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Sync</div>
        <div class="panel-body">
          <p class="muted">
            Sync reads <span class="mono">gojo.yaml</span> (or
            <span class="mono">.gojo/project.yaml</span>) and upserts profiles, agents, and
            schedules by name. Entries removed from the manifest are soft-disabled so they stop
            firing. Sync does not change git history or your working tree.
          </p>
          <div v-if="lastSync" class="mt-5 project-sync-result">
            <div>
              Manifest:
              <span class="mono">{{ lastSync.manifestPath ?? "not found" }}</span>
            </div>
            <div class="muted mt-2">
              {{ lastSync.profiles }} profiles · {{ lastSync.agents }} agents ·
              {{ lastSync.schedules }} schedules
            </div>
          </div>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Health</div>
        <div class="panel-body">
          <div v-if="!doctor" class="muted">Doctor results unavailable.</div>
          <ul v-else class="health-checklist">
            <li>
              <span :class="doctor.repoExists ? 'ok' : 'bad'">●</span>
              Repository path {{ doctor.repoExists ? "exists" : "is missing" }}
            </li>
            <li>
              <span :class="doctor.manifest ? 'ok' : 'bad'">●</span>
              Manifest file {{ doctor.manifest ? "found" : "not found" }}
            </li>
            <li>
              <span :class="doctor.baseCheckout.clean ? 'ok' : 'bad'">●</span>
              Base checkout
              {{ doctor.baseCheckout.clean ? "is clean" : "has local changes" }}
              <span v-if="doctor.baseCheckout.behindOrigin != null" class="muted">
                · {{ doctor.baseCheckout.behindOrigin }} commit(s) behind origin
              </span>
              <ul
                v-if="doctor.baseCheckout.dirtyFiles.length"
                class="muted mt-2 health-dirty-files"
              >
                <li
                  v-for="file in doctor.baseCheckout.dirtyFiles.slice(0, 12)"
                  :key="file"
                  class="mono"
                >
                  {{ file }}
                </li>
                <li v-if="doctor.baseCheckout.dirtyFiles.length > 12">
                  … +{{ doctor.baseCheckout.dirtyFiles.length - 12 }} more
                </li>
              </ul>
            </li>
            <li v-for="tool in doctor.validationTools" :key="`${tool.agent}:${tool.step}:${tool.binary}`">
              <span :class="tool.found ? 'ok' : 'bad'">●</span>
              Validation tool <span class="mono">{{ tool.binary }}</span>
              <template v-if="tool.shellBuiltin"> (shell builtin — ok)</template>
              <template v-else-if="tool.found"> found on daemon PATH</template>
              <template v-else> missing under daemon PATH</template>
              <span class="muted"> — {{ tool.agent }} / {{ tool.step }}</span>
            </li>
            <li v-if="doctor.validationTools.length === 0" class="muted">
              No validation tool checks reported
            </li>
          </ul>
        </div>
      </section>

      <section class="panel mb-7">
        <div class="panel-header">Configuration</div>
        <div class="panel-body">
          <div v-if="!project.hasManifest" class="muted">
            No synced manifest yet. Run Sync after adding a
            <span class="mono">gojo.yaml</span>.
          </div>
          <template v-else-if="!manifest.ok">
            <div class="alert alert-error">Could not parse manifest: {{ manifest.error }}</div>
          </template>
          <template v-else>
            <div v-if="Object.keys(manifest.repository).length" class="mb-7">
              <div class="panel-subheader">Repository</div>
              <ul class="project-kv">
                <li v-for="(value, key) in manifest.repository" :key="key">
                  <span class="mono">{{ key }}</span>
                  <span class="muted">{{ String(value) }}</span>
                </li>
              </ul>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Profiles ({{ manifest.profiles.length }})</div>
              <div v-if="manifest.profiles.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Adapter</th>
                      <th>Model</th>
                      <th>Timeout</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="profile in manifest.profiles" :key="profile.name">
                      <td class="entity-name">{{ profile.name }}</td>
                      <td class="mono">{{ profile.adapter }}</td>
                      <td class="mono muted">{{ profile.model ?? "—" }}</td>
                      <td class="mono muted">{{ profile.timeout ?? "—" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Agents ({{ manifest.agents.length }})</div>
              <div v-if="manifest.agents.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Profile</th>
                      <th>Integration</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="agent in manifest.agents" :key="agent.name">
                      <td>
                        <RouterLink
                          v-if="agentsByName.get(agent.name)"
                          :to="{
                            name: 'agent-detail',
                            params: { id: agentsByName.get(agent.name)!.id },
                          }"
                          class="entity-name"
                        >
                          {{ agent.name }}
                        </RouterLink>
                        <span v-else class="entity-name">{{ agent.name }}</span>
                      </td>
                      <td class="mono">{{ agent.profile }}</td>
                      <td class="mono">{{ agent.integrationMode }}</td>
                      <td class="muted">{{ agent.description || "—" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">Schedules ({{ manifest.schedules.length }})</div>
              <div v-if="manifest.schedules.length === 0" class="muted">None</div>
              <div v-else class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Agent</th>
                      <th>Cron</th>
                      <th>Timezone</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="schedule in manifest.schedules" :key="schedule.name">
                      <td class="entity-name">{{ schedule.name }}</td>
                      <td class="mono">{{ schedule.agent }}</td>
                      <td class="mono">{{ schedule.cron }}</td>
                      <td class="mono muted">{{ schedule.timezone }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="mb-7">
              <div class="panel-subheader">
                Validation profiles ({{ manifest.validationProfiles.length }})
              </div>
              <div v-if="manifest.validationProfiles.length === 0" class="muted">None</div>
              <ul v-else class="project-kv">
                <li v-for="profile in manifest.validationProfiles" :key="profile.name">
                  <span class="mono">{{ profile.name }}</span>
                  <span class="muted">{{ profile.stepCount }} steps</span>
                </li>
              </ul>
            </div>

            <details class="project-raw-json">
              <summary class="muted">Advanced: raw JSON</summary>
              <pre class="pre-block">{{ manifest.prettyJson }}</pre>
            </details>
          </template>
        </div>
      </section>
    </template>

    <ConfirmDialog
      :open="removeOpen"
      title="Remove project?"
      confirm-label="Remove project"
      danger
      :busy="busy"
      @close="removeOpen = false"
      @confirm="confirmRemove"
    >
      <p>
        Unregister <strong>{{ project?.name }}</strong> from gojo. Scheduled work for this project
        stops, and gojo’s local history for it is removed.
      </p>
      <p class="muted mt-3">
        This does <strong>not</strong> delete the git repository at
        <span class="mono">{{ project?.repoPath }}</span>.
      </p>
    </ConfirmDialog>

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
        active again, gojo will restore it to the command center.
      </p>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
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

.impact-task-toggles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  margin-top: 1rem;
}

.impact-task-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.875rem;
  cursor: pointer;
}

.impact-recent {
  margin-top: 1rem;
}

.history-row--nested td {
  background: color-mix(in srgb, var(--bg) 65%, transparent);
  color: var(--text-muted);
}

.history-work--nested {
  padding-left: calc(var(--space-4) + 1rem);
  position: relative;
}

.history-work--nested::before {
  content: "";
  position: absolute;
  left: 0.35rem;
  top: 0.55rem;
  width: 0.55rem;
  height: 0.55rem;
  border-left: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.source-health__item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
</style>
