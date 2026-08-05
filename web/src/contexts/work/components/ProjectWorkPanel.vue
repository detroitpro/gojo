<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";

import { runAgent } from "@/contexts/catalog/contract";
import type { Agent } from "@/contexts/catalog/types";
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
import ActionMenu, { type ActionMenuItem } from "@/ui/ActionMenu.vue";
import AppButton from "@/ui/AppButton.vue";
import ConfirmDialog from "@/ui/ConfirmDialog.vue";
import { bindStoreRefresh } from "@/platform/bind-store-refresh";
import AttentionBadge from "@/ui/status/AttentionBadge.vue";
import DeliveryBadge from "@/ui/status/DeliveryBadge.vue";
import ExecutionBadge from "@/ui/status/ExecutionBadge.vue";
import ProvenanceBadge from "@/ui/status/ProvenanceBadge.vue";
import SyncStateBadge from "@/ui/status/SyncStateBadge.vue";
import StatGrid from "@/ui/StatGrid.vue";
import StatTile from "@/ui/StatTile.vue";
import { MAX_PAGE_LIMIT } from "@/kernel/pagination";
import {
  attentionMenuItems,
  attentionPrimaryAction,
  workExternalHref,
} from "@/kernel/work-attention";
import {
  workAgentProfileLabel,
  workPrimaryLabel,
  workSecondaryLabel,
} from "@/kernel/work-display";
import { compareLabel } from "@/kernel/stat-metrics";
import { isVerifiedActiveDelivery } from "@/kernel/work-visibility";
import { ExternalLink, GitMerge, Play, RefreshCw } from "lucide-vue-next";

import ProjectSourcesPanel from "./ProjectSourcesPanel.vue";

const props = defineProps<{
  projectId: string;
  mergeBabysitter: Agent | null;
}>();

const emit = defineEmits<{
  error: [string];
  notice: [string];
  openPrTotal: [number];
}>();

const router = useRouter();

const workItems = ref<WorkItem[]>([]);
const workStatus = ref<WorkStatus | null>(null);
const projectSources = ref<ProjectSource[]>([]);
const openPrTotal = ref(0);
const mergeBusy = ref(false);
const attentionBusyId = ref("");
const resolveOpen = ref(false);
const resolveTarget = ref<WorkItem | null>(null);

function workCompareLabel(): string {
  return compareLabel("asOf", workStatus.value?.compareWindow);
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

function primaryAttentionAction(item: WorkItem) {
  return attentionPrimaryAction(item, sourceWebUrl(item));
}

function attentionActions(item: WorkItem): ActionMenuItem[] {
  return attentionMenuItems(item, sourceWebUrl(item));
}

async function runAttentionRecheck(item: WorkItem) {
  attentionBusyId.value = item.id;
  emit("error", "");
  emit("notice", "");
  try {
    const result = await recheckWorkItem(item.id);
    await loadWork();
    if (result.status === "terminal") {
      emit("notice", `Verified ${item.title} as ${result.work.delivery}`);
    } else if (result.status === "active") {
      emit("notice", `${item.title} is active in the source again`);
    } else {
      emit(
        "error",
        result.detail ??
          "Source could not confirm the final state. You can open it upstream or mark it resolved.",
      );
    }
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Recheck failed");
  } finally {
    attentionBusyId.value = "";
  }
}

async function runAttentionRetrySource(item: WorkItem) {
  if (!item.sourceId) return;
  attentionBusyId.value = item.id;
  emit("error", "");
  emit("notice", "");
  try {
    await refreshProjectSource(props.projectId, item.sourceId);
    await loadWork();
    emit("notice", `Retried source ${sourceLabel(item)}`);
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Source retry failed");
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
  emit("error", "");
  emit("notice", "");
  try {
    await resolveWorkItem(item.id, {
      note: "Marked resolved from project Needs attention",
    });
    resolveOpen.value = false;
    resolveTarget.value = null;
    await loadWork();
    emit(
      "notice",
      `Resolved ${item.title}. It will reappear if the source reports it active again.`,
    );
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Resolve failed");
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
    const [page, status, sources] = await Promise.all([
      listProjectWork(props.projectId, { limit: MAX_PAGE_LIMIT, offset: 0 }),
      getProjectWorkStatus(props.projectId),
      listProjectSources(props.projectId),
    ]);
    workItems.value = page.items;
    workStatus.value = status;
    projectSources.value = sources;
    openPrTotal.value = status.verifiedOpen;
    emit("openPrTotal", status.verifiedOpen);
  } catch {
    workItems.value = [];
    workStatus.value = null;
    projectSources.value = [];
    openPrTotal.value = 0;
    emit("openPrTotal", 0);
  }
}

async function runMergeBabysitter() {
  const agent = props.mergeBabysitter;
  if (!agent) {
    return;
  }
  mergeBusy.value = true;
  emit("error", "");
  try {
    const run = await runAgent(agent.id);
    await router.push({ name: "run-detail", params: { id: run.id } });
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Failed to enqueue merge babysitter");
    mergeBusy.value = false;
  }
}

watch(
  () => props.projectId,
  () => {
    workItems.value = [];
    workStatus.value = null;
    projectSources.value = [];
    openPrTotal.value = 0;
    void loadWork();
  },
);

const workStore = useWorkStore();
bindStoreRefresh(workStore, loadWork);

defineExpose({ loadWork });
</script>

<template>
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
      <ProjectSourcesPanel :sources="projectSources" />
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
</template>

<style scoped>
.impact-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
</style>
